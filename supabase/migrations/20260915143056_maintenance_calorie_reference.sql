begin;
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
