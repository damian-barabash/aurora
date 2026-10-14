-- Firma (holding) → marki → produkty. Wpis bez produktu należy do marki, wpis bez marki — do całej grupy.
-- Do tego poziomy widoczności wpisów, paczki propozycji i wersja aplikacji, którą użytkownik już widział.

-- ───────────────────────── marki ─────────────────────────

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  slug text not null,
  cluster text not null default '',
  aliases text[] not null default '{}',
  summary text not null default '',
  website text,
  logo_path text,
  position int not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);
create index on public.brands (company_id, position);

create or replace function public.touch_plain() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger brands_touch before update on public.brands
  for each row execute function public.touch_plain();

alter table public.brands enable row level security;
create policy brands_read on public.brands for select to authenticated using (public.is_member(company_id));
create policy brands_write on public.brands for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

-- ───────────────────────── przypisanie do marki ─────────────────────────

alter table public.products add column brand_id uuid references public.brands(id) on delete set null;
alter table public.entries add column brand_id uuid references public.brands(id) on delete set null;
alter table public.proposals add column brand_id uuid references public.brands(id) on delete set null;
alter table public.proposals add column batch_id uuid;
alter table public.files add column brand_id uuid references public.brands(id) on delete set null;
alter table public.web_sources add column brand_id uuid references public.brands(id) on delete set null;
create index on public.products (brand_id);
create index on public.entries (brand_id);
create index on public.proposals (company_id, batch_id) where batch_id is not null;

-- profil marki: jeden wiersz na markę, wiersz bez marki = profil całej grupy
alter table public.brand add column id uuid not null default gen_random_uuid();
alter table public.brand add column brand_id uuid references public.brands(id) on delete cascade;
alter table public.brand drop constraint brand_pkey;
alter table public.brand add primary key (id);
alter table public.brand add constraint brand_scope unique nulls not distinct (company_id, brand_id);

-- marka musi należeć do tej samej firmy co produkt / wpis
create or replace function public.check_brand_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.brand_id is not null and not exists (select 1 from brands b where b.id = new.brand_id and b.company_id = new.company_id) then
    raise exception 'brand_from_other_company';
  end if;
  return new;
end $$;
create trigger products_brand_check before insert or update of brand_id, company_id on public.products
  for each row execute function public.check_brand_company();
create trigger proposals_brand_check before insert or update of brand_id on public.proposals
  for each row execute function public.check_brand_company();

-- wpis z produktem dziedziczy markę produktu: jedno źródło prawdy, bez rozjazdów
create or replace function public.entry_brand() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.product_id is not null then
    select p.brand_id into new.brand_id from products p where p.id = new.product_id;
  end if;
  if new.brand_id is not null and not exists (select 1 from brands b where b.id = new.brand_id and b.company_id = new.company_id) then
    raise exception 'brand_from_other_company';
  end if;
  return new;
end $$;
create trigger entries_brand before insert or update of product_id, brand_id, company_id on public.entries
  for each row execute function public.entry_brand();

create or replace function public.product_brand_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.brand_id is distinct from old.brand_id then
    update entries set brand_id = new.brand_id where product_id = new.id;
    update proposals set brand_id = new.brand_id where product_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
create trigger products_brand_cascade after update of brand_id on public.products
  for each row execute function public.product_brand_cascade();

-- ───────────────────────── widoczność ─────────────────────────
-- public: można mówić klientom · internal: wiedza zespołu · confidential: strategia, tylko administratorzy

alter table public.entries add column visibility text not null default 'internal'
  check (visibility in ('public', 'internal', 'confidential'));
update public.entries set visibility = 'public' where source = 'website';

drop policy entries_read on public.entries;
create policy entries_read on public.entries for select to authenticated
  using (public.is_member(company_id) and (visibility <> 'confidential' or public.is_admin(company_id)));

drop policy history_read on public.history;
create policy history_read on public.history for select to authenticated
  using (public.is_member(company_id) and (
    public.is_admin(company_id)
    or coalesce(after->>'visibility', before->>'visibility', 'internal') <> 'confidential'));

-- powiadomienia o poufnym wpisie dostają tylko administratorzy
create or replace function public.notify_entry_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := coalesce(auth.uid(), new.updated_by); pname text; verb text;
begin
  if tg_op = 'UPDATE' and new.title = old.title and new.body = old.body
     and new.effective_from is not distinct from old.effective_from
     and new.status = old.status and new.importance = old.importance then
    return new;
  end if;
  if new.status = 'archived' then return new; end if;
  select name into pname from products where id = new.product_id;
  verb := case when tg_op = 'INSERT' then 'new' else 'update' end;

  if new.type in ('announcement', 'news') and new.importance >= 2 and tg_op = 'INSERT' then
    insert into notifications (user_id, company_id, type, title, body, link)
    select m.user_id, new.company_id, 'announcement', new.title, left(new.body, 240), '/app/news'
    from company_members m where m.company_id = new.company_id and m.user_id is distinct from actor
      and (new.visibility <> 'confidential' or m.role = 'admin');
  elsif new.product_id is not null then
    insert into notifications (user_id, company_id, type, title, body, link)
    select u.user_id, new.company_id, 'product_' || verb, coalesce(pname, '') || ' — ' || new.title,
           left(new.body, 240), '/app/kb/' || new.product_id
    from (
      select s.user_id from subscriptions s where s.product_id = new.product_id
      union
      select p.owner_id from products p where p.id = new.product_id and p.owner_id is not null
    ) u
    where u.user_id is distinct from actor
      and (new.visibility <> 'confidential' or exists (
        select 1 from company_members m where m.company_id = new.company_id and m.user_id = u.user_id and m.role = 'admin'));
  end if;
  return new;
end $$;

-- ───────────────────────── wersja aplikacji widziana przez użytkownika ─────────────────────────

alter table public.profiles add column seen_version text;

-- ───────────────────────── widok produktów (p.* rozwija kolumny w chwili tworzenia) ─────────────────────────

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

-- ───────────────────────── wyszukiwanie z uwzględnieniem marki ─────────────────────────

drop function public.match_entries(uuid, extensions.vector, text, int);
create function public.match_entries(
  p_company uuid, p_embedding extensions.vector(768), p_query text, p_limit int default 12,
  p_brand uuid default null, p_confidential boolean default false)
returns table (
  id uuid, product_id uuid, product_name text, brand_id uuid, brand_name text, type text, title text, body text,
  effective_from date, effective_to date, updated_at timestamptz, source text, status text, visibility text, score real)
language sql stable set search_path = public, extensions as $$
  select e.id, e.product_id, p.name, e.brand_id, b.name, e.type, e.title, e.body, e.effective_from, e.effective_to,
         e.updated_at, e.source, e.status, e.visibility,
         (coalesce(1 - (e.embedding <=> p_embedding), 0) * 0.75
          + greatest(word_similarity(p_query, e.title), word_similarity(p_query, coalesce(p.name, '')),
                     word_similarity(p_query, coalesce(b.name, ''))) * 0.25
          + 0.04 * greatest(0, 1 - extract(epoch from now() - e.updated_at) / (30 * 86400))
          - case when coalesce(e.effective_to, e.effective_from) < current_date and e.type = 'date' then 0.12
                 when e.effective_to < current_date then 0.08 else 0 end
          - case when e.status = 'review' then 0.03 else 0 end
          -- pytanie o konkretną markę: jej wpisy wyżej, wiedza grupy lekko, inne marki niżej
          + case when p_brand is null then 0
                 when e.brand_id = p_brand then 0.12
                 when e.brand_id is null then 0.03
                 else -0.10 end)::real as score
  from entries e
    left join products p on p.id = e.product_id
    left join brands b on b.id = e.brand_id
  where e.company_id = p_company and e.status in ('current', 'review')
    and (p.id is null or p.status <> 'archived')
    and (p_confidential or e.visibility <> 'confidential')
  order by score desc
  limit p_limit
$$;
revoke execute on function public.match_entries(uuid, extensions.vector, text, int, uuid, boolean) from anon, public, authenticated;
grant execute on function public.match_entries(uuid, extensions.vector, text, int, uuid, boolean) to service_role;

drop function public.nearest_entries(uuid, extensions.vector, int);
create function public.nearest_entries(p_company uuid, p_embedding extensions.vector(768), p_limit int default 3)
returns table (id uuid, product_id uuid, brand_id uuid, type text, title text, body text, effective_from date, effective_to date, cos real)
language sql stable set search_path = public, extensions as $$
  select e.id, e.product_id, e.brand_id, e.type, e.title, e.body, e.effective_from, e.effective_to,
         (1 - (e.embedding <=> p_embedding))::real as cos
  from entries e
  where e.company_id = p_company and e.status in ('current', 'review') and e.embedding is not null
  order by e.embedding <=> p_embedding
  limit p_limit
$$;
revoke execute on function public.nearest_entries(uuid, extensions.vector, int) from anon, public, authenticated;
grant execute on function public.nearest_entries(uuid, extensions.vector, int) to service_role;

-- ───────────────────────── machina czasu: marka i widoczność też wracają ─────────────────────────

create or replace function public.history_revert(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare h history; e entries; p products;
begin
  select * into h from history where id = p_id;
  if h.id is null or not public.is_member(h.company_id) then
    raise exception 'forbidden';
  end if;
  perform set_config('aurora.revert', '1', true);
  if h.target = 'entry' then
    if h.action = 'create' then
      update entries set status = 'archived' where id = h.entry_id;
    else
      e := jsonb_populate_record(null::entries, h.before);
      if exists (select 1 from entries where id = h.entry_id) then
        update entries set title = e.title, body = e.body, type = e.type, product_id = e.product_id, brand_id = e.brand_id,
          effective_from = e.effective_from, effective_to = e.effective_to, importance = e.importance,
          pinned = e.pinned, status = e.status, visibility = coalesce(e.visibility, 'internal'), embedding = null
        where id = h.entry_id;
      else
        e.embedding := null; e.updated_at := now(); e.visibility := coalesce(e.visibility, 'internal');
        insert into entries select e.*;
      end if;
    end if;
  else
    if h.action = 'create' then
      update products set status = 'archived' where id = h.product_id;
    elsif exists (select 1 from products where id = h.product_id) then
      p := jsonb_populate_record(null::products, h.before);
      update products set name = p.name, kind = p.kind, icon = p.icon, summary = p.summary,
        description = p.description, status = p.status, collection_id = p.collection_id,
        owner_id = p.owner_id, cover_path = p.cover_path, brand_id = p.brand_id
      where id = h.product_id;
    else
      p := jsonb_populate_record(null::products, h.before);
      p.updated_at := now();
      insert into products select p.*;
    end if;
  end if;
end $$;

revoke execute on function public.check_brand_company() from anon, authenticated, public;
revoke execute on function public.entry_brand() from anon, authenticated, public;
revoke execute on function public.product_brand_cascade() from anon, authenticated, public;
