begin;
create table public.health_bridge_devices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 80),
  token_hash text not null unique check(length(token_hash)=64),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index health_bridge_devices_owner on public.health_bridge_devices(user_id);
alter table public.health_bridge_devices enable row level security;
revoke all on public.health_bridge_devices from public,anon,authenticated;
grant select(id,user_id,name,created_at,revoked_at,last_seen_at) on public.health_bridge_devices to authenticated;
grant all on public.health_bridge_devices to service_role;
create policy "Lire ses passerelles" on public.health_bridge_devices for select to authenticated using((select auth.uid())=user_id);

create table public.health_snapshots(
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  source text not null check(length(source) between 1 and 200),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<25000),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key(user_id,day,source)
);
alter table public.health_snapshots enable row level security;
revoke all on public.health_snapshots from public,anon,authenticated;
grant select on public.health_snapshots to authenticated;
grant all on public.health_snapshots to service_role;
create policy "Lire ses dépenses importées" on public.health_snapshots for select to authenticated using((select auth.uid())=user_id);

-- Only the authenticated Edge Function service can ingest. Browsers cannot
-- mutate sensor rows, and retries arriving out of order cannot overwrite newer data.
create function public.ingest_health_snapshots(p_user uuid,p_snapshots jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare s jsonb;n integer:=0;changed integer;
begin
  if jsonb_typeof(p_snapshots)<>'array' or jsonb_array_length(p_snapshots)>31 then raise exception 'Invalid batch';end if;
  for s in select value from jsonb_array_elements(p_snapshots) loop
    insert into public.health_snapshots(user_id,day,source,payload,captured_at)
      values(p_user,(s->>'day')::date,s->>'source',s,(s->>'capturedAt')::timestamptz)
      on conflict(user_id,day,source) do update set payload=excluded.payload,captured_at=excluded.captured_at,received_at=now()
      where excluded.captured_at>health_snapshots.captured_at;
    get diagnostics changed=row_count;n:=n+changed;
  end loop;return n;
end $$;
revoke all on function public.ingest_health_snapshots(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_health_snapshots(uuid,jsonb) to service_role;
create or replace function public.save_account_profile(p_payload jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.account_profiles; inserted_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid revision'; end if;
  if p_expected_revision = 0 then
    insert into public.account_profiles(user_id, payload) values (auth.uid(), p_payload)
      on conflict (user_id) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then return jsonb_build_object('saved',true,'revision',1,'payload',p_payload); end if;
  end if;
  select * into current_row from public.account_profiles where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('saved',false,'revision',0,'payload',null); end if;
  if current_row.revision <> p_expected_revision then
    return jsonb_build_object('saved',false,'revision',current_row.revision,'payload',current_row.payload);
  end if;
  -- A maintenance total and a base excluding sport have different meanings.
  -- Old clients cannot safely edit a profile that already uses maintenance.
  if exists(select 1 from jsonb_each(current_row.payload->'goals') as g where g.value->>'maintenance' is not null)
     and exists(select 1 from jsonb_each(p_payload->'goals') as g where not (g.value ? 'maintenance')) then
    raise exception 'Actualise la page pour conserver le maintien calorique de ton profil.';
  end if;
  if exists(select 1 from jsonb_each(current_row.payload->'goals') as g where g.value->>'adaptive'='true')
     and exists(select 1 from jsonb_each(p_payload->'goals') as g where not(g.value ? 'adaptive')) then
    raise exception 'Actualise la page pour conserver la projection Santé Connect.';
  end if;
  -- Older tabs omit this optional field. Keep it unless a client explicitly sends null.
  if not (p_payload ? 'resting') and current_row.payload ? 'resting' then
    p_payload := p_payload || jsonb_build_object('resting',current_row.payload->'resting');
  end if;
  update public.account_profiles set payload = p_payload, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() returning * into current_row;
  return jsonb_build_object('saved',true,'revision',current_row.revision,'payload',current_row.payload);
end $$;
revoke all on function public.save_account_profile(jsonb,bigint) from public, anon;
grant execute on function public.save_account_profile(jsonb,bigint) to authenticated;

commit;
