begin;
do $$
declare test_user uuid:=gen_random_uuid(); p jsonb; r jsonb;
begin
  insert into auth.users(id,email) values(test_user,test_user::text||'@test.invalid');
  perform set_config('request.jwt.claim.sub',test_user::text,true);
  p:='{"goals":{"2000-01-01":{"base":null,"maintenance":2500,"plannedIntake":2200,"target":300,"adaptive":true,"includedActivity":300}},"weights":{}}';
  r:=public.save_account_profile(p,0);
  if (r->>'revision')::int<>1 then raise exception 'Insert failed'; end if;
  r:=public.save_account_profile(p #- '{goals,2000-01-01,includedActivity}',1);
  if r->'payload'->'goals'->'2000-01-01'->>'includedActivity'<>'300' then raise exception 'Old client erased included activity'; end if;
  r:=public.save_account_profile(p,1);
  if (r->>'saved')::boolean then raise exception 'Stale revision was accepted'; end if;
  begin
    perform public.save_account_profile(jsonb_set(p,'{goals,2000-01-01,includedActivity}','2600'),2);
    raise exception 'Invalid activity was accepted';
  exception when raise_exception then
    if sqlerrm='Invalid activity was accepted' then raise; end if;
  end;
  if has_function_privilege('anon','public.save_account_profile(jsonb,bigint)','execute') then raise exception 'Anonymous profile access'; end if;
end $$;
select 'PASS: envelope retained, old clients and stale revisions handled, invalid values rejected' as result;
rollback;
