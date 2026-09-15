begin;
select set_config('test.user_a',gen_random_uuid()::text,true), set_config('test.user_b',gen_random_uuid()::text,true);
insert into auth.users(id,email) values
(current_setting('test.user_a')::uuid, current_setting('test.user_a') || '@test.invalid'),
(current_setting('test.user_b')::uuid, current_setting('test.user_b') || '@test.invalid');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
do $$
declare r jsonb; n integer;
begin
  begin
    perform public.save_journal_day('2000-01-01','{"schemaVersion":3}',0);
    raise exception 'Old client accepted';
  exception when invalid_parameter_value then null;
  end;
  r:=public.save_journal_day('2000-01-01','{"schemaVersion":4}',0);
  if not (r->>'saved')::boolean or (r->>'revision')::int<>1 then raise exception 'Initial insert failed';end if;
  r:=public.save_journal_day('2000-01-01','{"schemaVersion":4,"test":2}',0);
  if (r->>'saved')::boolean or (r->>'revision')::int<>1 then raise exception 'Stale revision overwrote data';end if;
  r:=public.save_journal_day('2000-01-01','{"schemaVersion":4,"test":2}',1);
  if not (r->>'saved')::boolean or (r->>'revision')::int<>2 then raise exception 'Valid update failed';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
  select count(*) into n from public.journal_days;
  if n<>0 then raise exception 'Cross-account read allowed';end if;
  update public.journal_days set payload='{"unauthorized":true}' where user_id=current_setting('test.user_a')::uuid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Cross-account update allowed';end if;
  begin
    insert into public.journal_days(user_id,day,payload) values(current_setting('test.user_a')::uuid,'2000-01-02','{}');
    raise exception 'Cross-account insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.journal_days','SELECT') or has_table_privilege('anon','public.journal_days','INSERT') or has_function_privilege('anon','public.save_journal_day(date,jsonb,bigint)','EXECUTE') then raise exception 'Anonymous access allowed';end if;
end $$;
select 'PASS: isolation utilisateurs, accès anonyme interdit, écriture et conflit de version' as verification;
rollback;
