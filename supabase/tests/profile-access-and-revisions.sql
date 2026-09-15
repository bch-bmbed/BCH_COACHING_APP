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
  r:=public.save_account_profile('{"goals":{},"weights":{},"resting":1760}',0);
  if not (r->>'saved')::boolean or (r->>'revision')::int<>1 then raise exception 'Initial insert failed';end if;
  r:=public.save_account_profile('{"goals":{},"weights":{"2000-01-01":80}}',0);
  if (r->>'saved')::boolean or (r->>'revision')::int<>1 then raise exception 'Stale revision overwrote data';end if;
  r:=public.save_account_profile('{"goals":{},"weights":{"2000-01-01":80}}',1);
  if not (r->>'saved')::boolean or (r->>'revision')::int<>2 then raise exception 'Valid update failed';end if;
  if (r->'payload'->>'resting')::numeric is distinct from 1760 then raise exception 'Old client erased resting metabolism';end if;
  begin
    perform public.save_account_profile('{}',2);
    raise exception 'Malformed profile accepted';
  exception when check_violation then null;
  end;
  r:=public.save_account_profile('{"goals":{},"weights":{},"resting":null}',2);
  if not (r->>'saved')::boolean or r->'payload'->'resting' is distinct from 'null'::jsonb then raise exception 'Explicit clearing failed';end if;
  begin
    perform public.save_account_profile('{"goals":{},"weights":{},"resting":"invalid"}',3);
    raise exception 'Invalid metabolism accepted';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
  select count(*) into n from public.account_profiles;
  if n<>0 then raise exception 'Cross-account read allowed';end if;
  update public.account_profiles set payload='{"goals":{},"weights":{}}' where user_id=current_setting('test.user_a')::uuid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Cross-account update allowed';end if;
  begin
    insert into public.account_profiles(user_id,payload) values(current_setting('test.user_a')::uuid,'{"goals":{},"weights":{}}');
    raise exception 'Cross-account insert allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.account_profiles','SELECT') or has_table_privilege('anon','public.account_profiles','INSERT') or has_function_privilege('anon','public.save_account_profile(jsonb,bigint)','EXECUTE') then raise exception 'Anonymous access allowed';end if;
end $$;
select 'PASS profil: structure valide, isolation utilisateurs, accès anonyme interdit, écriture et conflit de version' as verification;
rollback;
