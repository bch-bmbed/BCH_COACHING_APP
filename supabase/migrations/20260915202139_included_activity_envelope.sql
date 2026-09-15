CREATE OR REPLACE FUNCTION public.save_account_profile(p_payload jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_row public.account_profiles; inserted_count integer; entry record; retained jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid revision'; end if;
  if exists(select 1 from jsonb_each(p_payload->'goals') g where g.value ? 'includedActivity' and g.value->'includedActivity' <> 'null'::jsonb and
    (jsonb_typeof(g.value->'includedActivity') <> 'number' or (g.value->>'includedActivity')::numeric < 0 or (g.value->>'includedActivity')::numeric > 30000 or g.value->>'maintenance' is null or (g.value->>'includedActivity')::numeric > (g.value->>'maintenance')::numeric)) then
    raise exception 'Activité incluse invalide : elle doit être comprise dans le maintien.';
  end if;
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
  -- Older clients omit the envelope; preserve its effective dated value.
  for entry in select key,value from jsonb_each(p_payload->'goals') loop
    if not (entry.value ? 'includedActivity') and entry.value->>'maintenance' is not null then
      select g.value->'includedActivity' into retained from jsonb_each(current_row.payload->'goals') g
        where g.key <= entry.key and g.value ? 'includedActivity' order by g.key desc limit 1;
      if retained is not null then
        p_payload := jsonb_set(p_payload,array['goals',entry.key,'includedActivity'],retained);
      end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_each(p_payload->'goals') g where g.value ? 'includedActivity' and g.value->'includedActivity' <> 'null'::jsonb and
    (jsonb_typeof(g.value->'includedActivity') <> 'number' or (g.value->>'includedActivity')::numeric < 0 or (g.value->>'includedActivity')::numeric > 30000 or g.value->>'maintenance' is null or (g.value->>'includedActivity')::numeric > (g.value->>'maintenance')::numeric)) then
    raise exception 'Activité incluse invalide : elle doit être comprise dans le maintien.';
  end if;
  update public.account_profiles set payload = p_payload, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() returning * into current_row;
  return jsonb_build_object('saved',true,'revision',current_row.revision,'payload',current_row.payload);
end $function$;

revoke all on function public.save_account_profile(jsonb,bigint) from public,anon;
grant execute on function public.save_account_profile(jsonb,bigint) to authenticated;
