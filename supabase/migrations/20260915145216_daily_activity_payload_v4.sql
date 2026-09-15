begin;

-- Protect the new step and walking-calorie fields from an older browser tab that
-- does not know them and would otherwise remove them on its next full-day save.
create or replace function public.save_journal_day(p_day date, p_payload jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.journal_days; inserted_count integer; payload_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid revision'; end if;
  begin
    payload_version := coalesce((p_payload ->> 'schemaVersion')::integer, 0);
  exception when invalid_text_representation then
    raise exception 'Invalid journal payload version' using errcode = '22023';
  end;
  if payload_version < 4 then
    raise exception 'Client update required before saving journal data' using errcode = '22023';
  end if;
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
