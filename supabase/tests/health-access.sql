begin;
select set_config('test.user_a',gen_random_uuid()::text,true),set_config('test.user_b',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('test.user_a')::uuid,current_setting('test.user_a')||'@test.invalid'),(current_setting('test.user_b')::uuid,current_setting('test.user_b')||'@test.invalid');
insert into public.health_bridge_devices(user_id,name,token_hash) values(current_setting('test.user_a')::uuid,'Test',repeat('a',64));
select public.ingest_health_snapshots(current_setting('test.user_a')::uuid,'[{"day":"2000-01-01","source":"test","capturedAt":"2000-01-02T00:00:00Z","value":2}]');
select public.ingest_health_snapshots(current_setting('test.user_a')::uuid,'[{"day":"2000-01-01","source":"test","capturedAt":"2000-01-01T00:00:00Z","value":1}]');
do $$begin
 if(select payload->>'value' from public.health_snapshots where user_id=current_setting('test.user_a')::uuid)<>'2' then raise exception 'Old upload replaced new snapshot';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
do $$declare n integer;r jsonb;begin
 select count(*) into n from public.health_snapshots;if n<>1 then raise exception 'Owner cannot read data';end if;
 begin perform token_hash from public.health_bridge_devices;raise exception 'Device hashes readable';exception when insufficient_privilege then null;end;
 begin perform public.ingest_health_snapshots(current_setting('test.user_b')::uuid,'[]');raise exception 'Client can ingest as another owner';exception when insufficient_privilege then null;end;
 begin update public.health_snapshots set payload='{}';raise exception 'Client can overwrite sensor data';exception when insufficient_privilege then null;end;
 r:=public.save_account_profile('{"goals":{"2000-01-01":{"maintenance":2400,"base":null,"plannedIntake":2100,"target":300,"adaptive":true}},"weights":{}}',0);
 begin perform public.save_account_profile('{"goals":{"2000-01-01":{"maintenance":2400,"base":null,"plannedIntake":2100,"target":300}},"weights":{}}',1);raise exception 'Old client erased adaptive mode';exception when raise_exception then if sqlerrm not like 'Actualise la page%' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
 select count(*) into n from public.health_snapshots;if n<>0 then raise exception 'Cross-user data exposed';end if;
 select count(*) into n from public.health_bridge_devices;if n<>0 then raise exception 'Cross-user devices exposed';end if;
end $$;
set local role anon;
do $$begin
 begin perform user_id from public.health_snapshots;raise exception 'Anonymous data readable';exception when insufficient_privilege then null;end;
 begin perform public.ingest_health_snapshots(gen_random_uuid(),'[]');raise exception 'Anonymous upload allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS health: isolation, secrets hidden, service-only ingestion, stale uploads, profile compatibility' as verification;
