begin;
select set_config('test.multi_user',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('test.multi_user')::uuid,current_setting('test.multi_user')||'@test.invalid');
do $$
declare u uuid:=current_setting('test.multi_user')::uuid;s jsonb;p jsonb;
begin
  s:='{"version":2,"source":"health-connect","day":"2000-01-01","capturedAt":"2000-01-02T00:00:00Z","sessions":[{"id":"first"}],"steps":123,"bins":[{"total":150}],"permissions":{"sessions":true,"steps":true,"total":true}}';
  perform public.ingest_health_snapshots(u,jsonb_build_array(s));
  s:=s||'{"capturedAt":"2000-01-03T00:00:00Z","sessions":[],"steps":null,"bins":[],"permissions":{"sessions":false,"steps":false,"total":false}}';
  perform public.ingest_health_snapshots(u,jsonb_build_array(s));
  select payload into p from public.health_snapshots where user_id=u;
  if jsonb_array_length(p->'sessions')<>1 or p->>'steps'<>'123' or jsonb_array_length(p->'bins')<>1 then raise exception 'Denied permissions removed imported data';end if;
  s:=s||'{"capturedAt":"2000-01-04T00:00:00Z","permissions":{"sessions":true,"steps":true,"total":true}}';
  perform public.ingest_health_snapshots(u,jsonb_build_array(s));
  select payload into p from public.health_snapshots where user_id=u;
  if jsonb_array_length(p->'sessions')<>0 then raise exception 'Deleted source session stayed visible';end if;
  perform public.ingest_health_snapshots(u,jsonb_build_array(s||'{"capturedAt":"2000-01-02T00:00:00Z","sessions":[{"id":"stale"}]}'));
  select payload into p from public.health_snapshots where user_id=u;
  if jsonb_array_length(p->'sessions')<>0 then raise exception 'Stale upload resurrected a session';end if;
end $$;
select 'PASS: denied permissions preserve history; source deletion and stale retries handled' as verification;
rollback;
