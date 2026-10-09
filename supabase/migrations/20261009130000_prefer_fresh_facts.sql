-- Wyszukiwanie: świeże fakty przed starymi, miniony termin spada na koniec

create or replace function public.match_entries(
  p_company uuid, p_embedding extensions.vector(768), p_query text, p_limit int default 12)
returns table (
  id uuid, product_id uuid, product_name text, type text, title text, body text,
  effective_from date, effective_to date, updated_at timestamptz, source text, status text, score real)
language sql stable set search_path = public, extensions as $$
  select e.id, e.product_id, p.name, e.type, e.title, e.body, e.effective_from, e.effective_to,
         e.updated_at, e.source, e.status,
         (coalesce(1 - (e.embedding <=> p_embedding), 0) * 0.75
          + greatest(word_similarity(p_query, e.title), word_similarity(p_query, coalesce(p.name, ''))) * 0.25
          -- wpis zmieniony w ostatnich 30 dniach dostaje niewielką premię, wygasły — karę
          + 0.04 * greatest(0, 1 - extract(epoch from now() - e.updated_at) / (30 * 86400))
          - case when coalesce(e.effective_to, e.effective_from) < current_date and e.type = 'date' then 0.12
                 when e.effective_to < current_date then 0.08 else 0 end
          - case when e.status = 'review' then 0.03 else 0 end)::real as score
  from entries e left join products p on p.id = e.product_id
  where e.company_id = p_company and e.status in ('current', 'review')
    and (p.id is null or p.status <> 'archived')
  order by score desc
  limit p_limit
$$;
