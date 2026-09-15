begin;

create table if not exists public.journal_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null check (day between date '1900-01-01' and date '2100-12-31'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) < 200000),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.journal_days enable row level security;
revoke all on public.journal_days from anon, authenticated;
grant select, insert, update on public.journal_days to authenticated;

create policy "Lire son journal" on public.journal_days for select to authenticated using ((select auth.uid()) = user_id);
create policy "Ajouter ses journées" on public.journal_days for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Modifier ses journées" on public.journal_days for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Optimistic concurrency: no last-writer-wins overwrite of another device's day.
create or replace function public.save_journal_day(p_day date, p_payload jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.journal_days; inserted_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid revision'; end if;
  if p_expected_revision = 0 then
    insert into public.journal_days(user_id, day, payload) values (auth.uid(), p_day, p_payload)
      on conflict (user_id, day) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then return jsonb_build_object('saved',true,'revision',1,'payload',p_payload); end if;
  end if;
  select * into current_row from public.journal_days where user_id = auth.uid() and day = p_day for update;
  if not found then return jsonb_build_object('saved',false,'revision',0,'payload',null); end if;
  if current_row.revision <> p_expected_revision then
    return jsonb_build_object('saved',false,'revision',current_row.revision,'payload',current_row.payload);
  end if;
  update public.journal_days set payload = p_payload, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() and day = p_day returning * into current_row;
  return jsonb_build_object('saved',true,'revision',current_row.revision,'payload',current_row.payload);
end $$;
revoke all on function public.save_journal_day(date,jsonb,bigint) from public, anon;
grant execute on function public.save_journal_day(date,jsonb,bigint) to authenticated;
commit;
