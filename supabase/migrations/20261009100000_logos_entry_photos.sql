-- Logo produktu i zdjęcia przypięte do wpisów (materiałów)

alter table public.products add column logo_path text;
alter table public.files add column entry_id uuid references public.entries(id) on delete cascade;
create index files_entry_idx on public.files (entry_id) where entry_id is not null;

-- widok wymienia kolumny produktu w chwili tworzenia, więc trzeba go odtworzyć
drop view public.products_v;
create view public.products_v with (security_invoker = true) as
select p.*,
  (select count(*) from entries e where e.product_id = p.id and e.status <> 'archived') as entries_count,
  (select count(*) from files f where f.product_id = p.id) as files_count,
  (select count(*) from proposals r where r.product_id = p.id and r.status = 'pending') as pending_count,
  greatest(p.updated_at, coalesce((select max(e.updated_at) from entries e where e.product_id = p.id), p.updated_at)) as last_change,
  case
    when p.status = 'archived' then 'archived'
    when p.status = 'review' then 'review'
    when exists (select 1 from proposals r where r.product_id = p.id and r.status = 'pending') then 'review'
    when exists (select 1 from entries e where e.product_id = p.id and e.status = 'review') then 'review'
    when exists (select 1 from entries e where e.product_id = p.id and e.status = 'current'
                 and e.effective_to is not null and e.effective_to < current_date) then 'review'
    when greatest(coalesce(p.last_verified_at, p.created_at),
           coalesce((select max(e.updated_at) from entries e where e.product_id = p.id), p.created_at))
         < now() - make_interval(days => coalesce((select (c.settings->>'stale_days')::int from companies c where c.id = p.company_id), 120))
      then 'review'
    else 'current'
  end as state
from products p;

-- zmiana samego logo nie jest zmianą wiedzy: nie trafia do historii
create or replace function public.log_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['embedding', 'updated_at', 'updated_by', 'verified_at', 'last_verified_at', 'confidence', 'logo_path'];
  b jsonb; a jsonb; r record; tgt text; act text;
begin
  tgt := case tg_table_name when 'products' then 'product' else 'entry' end;
  if tg_op = 'DELETE' then
    r := old; b := to_jsonb(old) - skip; a := null; act := 'delete';
    if not exists (select 1 from companies where id = old.company_id) then return old; end if;
  elsif tg_op = 'INSERT' then
    r := new; b := null; a := to_jsonb(new) - skip; act := 'create';
  else
    r := new; b := to_jsonb(old) - skip; a := to_jsonb(new) - skip; act := 'update';
    if a = b then return new; end if;
  end if;
  insert into history (company_id, product_id, entry_id, target, action, title, before, after, source, actor)
  values (
    r.company_id,
    case when tgt = 'product' then r.id else (to_jsonb(r)->>'product_id')::uuid end,
    case when tgt = 'entry' then r.id end,
    tgt,
    case when coalesce(current_setting('aurora.revert', true), '') = '1' then 'revert' else act end,
    coalesce(to_jsonb(r)->>'title', to_jsonb(r)->>'name', ''),
    b, a,
    coalesce(to_jsonb(r)->>'source', 'manual'),
    coalesce(auth.uid(), (to_jsonb(r)->>'updated_by')::uuid)
  );
  return coalesce(new, old);
end $$;
