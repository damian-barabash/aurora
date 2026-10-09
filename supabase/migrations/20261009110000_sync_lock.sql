-- Jedna synchronizacja skrzynki naraz: cron, „Sprawdź teraz” i pierwsze podłączenie potrafiły ruszyć równolegle
-- i ten sam mail trafiał do bazy dwa razy.

alter table public.integrations add column locked_until timestamptz;

create or replace function public.claim_integration(p_id uuid, p_seconds int default 150) returns boolean
language plpgsql security definer set search_path = public as $$
declare hit uuid;
begin
  update integrations set locked_until = now() + make_interval(secs => p_seconds)
  where id = p_id and (locked_until is null or locked_until < now())
  returning id into hit;
  return hit is not null;
end $$;
revoke execute on function public.claim_integration(uuid, int) from anon, public, authenticated;
grant execute on function public.claim_integration(uuid, int) to service_role;
