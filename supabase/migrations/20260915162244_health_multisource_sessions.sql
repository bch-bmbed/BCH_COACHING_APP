begin;
alter table public.health_snapshots drop constraint health_snapshots_payload_check;
alter table public.health_snapshots add constraint health_snapshots_payload_check check(jsonb_typeof(payload)='object' and octet_length(payload::text)<600000);
create or replace function public.ingest_health_snapshots(p_user uuid,p_snapshots jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare s jsonb;n integer:=0;changed integer;
begin
  if jsonb_typeof(p_snapshots)<>'array' or jsonb_array_length(p_snapshots)>31 then raise exception 'Invalid batch';end if;
  for s in select value from jsonb_array_elements(p_snapshots) loop
    insert into public.health_snapshots(user_id,day,source,payload,captured_at)
      values(p_user,(s->>'day')::date,s->>'source',s,(s->>'capturedAt')::timestamptz)
      on conflict(user_id,day,source) do update set
        payload=excluded.payload
          || case when excluded.payload->>'version'='2' and excluded.payload->'permissions'->>'sessions'='false' then jsonb_build_object('sessions',coalesce(health_snapshots.payload->'sessions','[]'::jsonb)) else '{}'::jsonb end
          || case when excluded.payload->>'version'='2' and excluded.payload->'permissions'->>'steps'='false' then jsonb_build_object('steps',health_snapshots.payload->'steps') else '{}'::jsonb end
          || case when excluded.payload->>'version'='2' and excluded.payload->'permissions'->>'total'='false' then jsonb_build_object('bins',health_snapshots.payload->'bins') else '{}'::jsonb end,
        captured_at=excluded.captured_at,received_at=now()
      where excluded.captured_at>health_snapshots.captured_at;
    get diagnostics changed=row_count;n:=n+changed;
  end loop;return n;
end $$;
revoke all on function public.ingest_health_snapshots(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_health_snapshots(uuid,jsonb) to service_role;
commit;
