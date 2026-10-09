-- Kto zadał pytanie w „Lukach w wiedzy”, widzi tylko moderator: kolumna user_id znika z uprawnień zwykłych ról

revoke select on public.knowledge_gaps from authenticated, anon;
grant select (id, company_id, question, status, hits, created_at, updated_at) on public.knowledge_gaps to authenticated;

create or replace function public.gap_authors(p_company uuid) returns table (gap_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  select g.id, g.user_id from knowledge_gaps g
  where g.company_id = p_company and public.is_moderator()
$$;
revoke execute on function public.gap_authors(uuid) from anon, public;
grant execute on function public.gap_authors(uuid) to authenticated;
