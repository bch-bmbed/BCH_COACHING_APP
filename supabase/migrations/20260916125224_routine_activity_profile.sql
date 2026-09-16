begin;
-- Reject silent data loss when an older browser drops the new fields.
create or replace function public.protect_routine_profile()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from jsonb_each(old.payload->'goals') g where g.value->'routine' is not null and g.value->'routine'<>'null'::jsonb)
     and exists(select 1 from jsonb_each(new.payload->'goals') g where not(g.value ? 'routine')) then
    raise exception 'Actualise la page pour conserver ton profil de journée et tes horaires.';
  end if;
  return new;
end $$;
revoke all on function public.protect_routine_profile() from public,anon,authenticated;
create trigger protect_routine_profile before update on public.account_profiles for each row execute function public.protect_routine_profile();

create or replace function public.protect_routine_day()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (old.payload ? 'movementOverrides' and not(new.payload ? 'movementOverrides')) or (old.payload ? 'routineDay' and not(new.payload ? 'routineDay')) then
    raise exception 'Actualise la page pour conserver le classement des déplacements de cette journée.';
  end if;
  return new;
end $$;
revoke all on function public.protect_routine_day() from public,anon,authenticated;
create trigger protect_routine_day before update on public.journal_days for each row execute function public.protect_routine_day();

create or replace function public.retain_movement_without_permission()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.payload->'permissions'->>'steps'='false' and old.payload ? 'movement' then
    new.payload := new.payload || jsonb_build_object('movement',old.payload->'movement');
  end if;
  return new;
end $$;
revoke all on function public.retain_movement_without_permission() from public,anon,authenticated;
create trigger retain_movement_without_permission before update on public.health_snapshots for each row execute function public.retain_movement_without_permission();
commit;
