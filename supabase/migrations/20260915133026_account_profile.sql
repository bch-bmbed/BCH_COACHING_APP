begin;

create table if not exists public.account_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) < 2000000 and payload ?& array['goals','weights'] and jsonb_typeof(payload->'goals') = 'object' and jsonb_typeof(payload->'weights') = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id)
);
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from anon, authenticated;
grant select, insert, update on public.account_profiles to authenticated;

create policy "Lire son profil" on public.account_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Créer son profil" on public.account_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Modifier son profil" on public.account_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Optimistic concurrency: no last-writer-wins overwrite of another device's profile.
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
  update public.account_profiles set payload = p_payload, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() returning * into current_row;
  return jsonb_build_object('saved',true,'revision',current_row.revision,'payload',current_row.payload);
end $$;
revoke all on function public.save_account_profile(jsonb,bigint) from public, anon;
grant execute on function public.save_account_profile(jsonb,bigint) to authenticated;
-- Retain dated values already entered, then reuse them as account defaults.
insert into public.account_profiles(user_id,payload)
select user_id,jsonb_build_object(
  'goals',coalesce(jsonb_object_agg(day::text,jsonb_build_object('plannedIntake',payload->'plannedIntake','base',payload->'base','target',payload->'target')),'{}'::jsonb),
  'weights',coalesce(jsonb_object_agg(day::text,payload->'weight') filter(where payload->>'weight' is not null),'{}'::jsonb))
from public.journal_days group by user_id
on conflict(user_id) do nothing;
commit;
