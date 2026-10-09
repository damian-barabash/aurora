-- Najbliższe znaczeniowo wpisy (czysta odległość kosinusowa) — do wykrywania dubli przy dodawaniu nowych faktów

create or replace function public.nearest_entries(p_company uuid, p_embedding extensions.vector(768), p_limit int default 3)
returns table (id uuid, product_id uuid, type text, title text, body text, effective_from date, effective_to date, cos real)
language sql stable set search_path = public, extensions as $$
  select e.id, e.product_id, e.type, e.title, e.body, e.effective_from, e.effective_to,
         (1 - (e.embedding <=> p_embedding))::real as cos
  from entries e
  where e.company_id = p_company and e.status in ('current', 'review') and e.embedding is not null
  order by e.embedding <=> p_embedding
  limit p_limit
$$;
revoke execute on function public.nearest_entries(uuid, extensions.vector, int) from anon, public, authenticated;
grant execute on function public.nearest_entries(uuid, extensions.vector, int) to service_role;
