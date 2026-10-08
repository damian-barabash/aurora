-- AURORA — baza wiedzy firmy: schemat, RLS, historia, powiadomienia

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ───────────────────────── konta i firmy ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  avatar_url text,
  is_moderator boolean not null default false,
  locale text not null default 'ru',
  onboarding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  website text,
  logo_path text,
  settings jsonb not null default '{"auto_apply": true, "stale_days": 120}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index on public.company_members (user_id);

create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_moderator from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_moderator() or coalesce(exists(
    select 1 from company_members where company_id = cid and user_id = auth.uid()), false)
$$;

create or replace function public.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_moderator() or coalesce(exists(
    select 1 from company_members where company_id = cid and user_id = auth.uid() and role = 'admin'), false)
$$;

create or replace function public.shares_company(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from company_members a join company_members b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = uid), false)
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- rola moderatora zmienia się tylko po stronie serwera
create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), 'postgres') in ('authenticated', 'anon') then
    new.is_moderator := old.is_moderator;
    new.email := old.email;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ───────────────────────── baza wiedzy ─────────────────────────

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  icon text not null default 'folder',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.collections (company_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  name text not null,
  kind text not null default '',
  icon text not null default 'spark',
  summary text not null default '',
  description text not null default '',
  cover_path text,
  status text not null default 'current' check (status in ('current', 'review', 'archived')),
  owner_id uuid references public.profiles(id) on delete set null,
  last_verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.products (company_id);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  type text not null default 'fact'
    check (type in ('fact', 'price', 'date', 'news', 'announcement', 'faq', 'link', 'document')),
  title text not null,
  body text not null default '',
  effective_from date,
  effective_to date,
  importance smallint not null default 1 check (importance between 0 and 3),
  pinned boolean not null default false,
  status text not null default 'current' check (status in ('current', 'review', 'outdated', 'archived')),
  source text not null default 'manual'
    check (source in ('manual', 'email', 'calendar', 'claude', 'website', 'file', 'chat')),
  source_label text,
  source_meta jsonb not null default '{}'::jsonb,
  confidence real,
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  embedding extensions.vector(768)
);
create index on public.entries (company_id, updated_at desc);
create index on public.entries (product_id);
create index entries_embedding_idx on public.entries using hnsw (embedding extensions.vector_cosine_ops);

create table public.brand (
  company_id uuid primary key references public.companies(id) on delete cascade,
  tagline text not null default '',
  strategy text not null default '',
  audience text not null default '',
  tone text not null default '',
  dos text not null default '',
  donts text not null default '',
  colors jsonb not null default '[]'::jsonb,
  fonts jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  kind text not null default 'document' check (kind in ('image', 'logo', 'document', 'brand')),
  name text not null,
  path text not null,
  mime text,
  size bigint,
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.files (company_id, created_at desc);

-- propozycje zmian z poczty, kalendarza, Claude, strony WWW
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'new' check (kind in ('new', 'update', 'conflict', 'new_product')),
  source text not null,
  source_label text,
  source_user uuid references public.profiles(id) on delete set null,
  product_id uuid references public.products(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete cascade,
  payload jsonb not null,
  summary text not null default '',
  evidence text not null default '',
  confidence real,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  dedupe_key text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.proposals (company_id, status, created_at desc);
create unique index proposals_dedupe on public.proposals (company_id, dedupe_key) where status = 'pending';

create table public.history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid,
  entry_id uuid,
  target text not null check (target in ('product', 'entry')),
  action text not null check (action in ('create', 'update', 'delete', 'revert')),
  title text not null default '',
  before jsonb,
  after jsonb,
  source text not null default 'manual',
  actor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.history (company_id, created_at desc);
create index on public.history (product_id, created_at desc);

create table public.subscriptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.digests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  day date not null,
  content text not null,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, day)
);

-- ───────────────────────── czat ─────────────────────────

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.chats (user_id, company_id, updated_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.chat_messages (chat_id, created_at);

create table public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  question text not null,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  hits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.knowledge_gaps (company_id, status, updated_at desc);

-- ───────────────────────── integracje ─────────────────────────

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('google')),
  account_email text,
  scopes text not null default '',
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_sync_at timestamptz,
  last_error text,
  cursor jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, company_id, provider)
);

-- tokeny tylko dla funkcji serwerowych (RLS bez polityk)
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz
);

create table public.ingest_log (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  external_id text not null,
  outcome text not null default '',
  processed_at timestamptz not null default now(),
  primary key (integration_id, external_id)
);

create table public.oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  return_to text not null,
  created_at timestamptz not null default now()
);

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null default 'Claude',
  token_hash text not null unique,
  preview text not null,
  last_used_at timestamptz,
  calls int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.web_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  url text not null,
  status text not null default 'queued' check (status in ('queued', 'crawling', 'ready', 'error')),
  queue jsonb not null default '[]'::jsonb,
  pages jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  last_error text,
  last_crawled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, url)
);

create table public.platform_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── historia zmian («machina czasu») ─────────────────────────

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();

create or replace function public.stamp_created_by() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;
create trigger products_stamp before insert on public.products
  for each row execute function public.stamp_created_by();
create trigger entries_stamp before insert on public.entries
  for each row execute function public.stamp_created_by();

create or replace function public.log_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['embedding', 'updated_at', 'updated_by', 'verified_at', 'last_verified_at', 'confidence'];
  b jsonb; a jsonb; r record; tgt text; act text;
begin
  tgt := case tg_table_name when 'products' then 'product' else 'entry' end;
  if tg_op = 'DELETE' then
    r := old; b := to_jsonb(old) - skip; a := null; act := 'delete';
    -- usunięcie całej firmy lub produktu: nie ma już do czego dopisać historii
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
create trigger products_history after insert or update or delete on public.products
  for each row execute function public.log_history();
create trigger entries_history after insert or update or delete on public.entries
  for each row execute function public.log_history();

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
        update entries set title = e.title, body = e.body, type = e.type, product_id = e.product_id,
          effective_from = e.effective_from, effective_to = e.effective_to, importance = e.importance,
          pinned = e.pinned, status = e.status, embedding = null
        where id = h.entry_id;
      else
        e.embedding := null; e.updated_at := now();
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
        owner_id = p.owner_id, cover_path = p.cover_path
      where id = h.product_id;
    else
      p := jsonb_populate_record(null::products, h.before);
      p.updated_at := now();
      insert into products select p.*;
    end if;
  end if;
end $$;

-- ───────────────────────── powiadomienia ─────────────────────────

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
    from company_members m where m.company_id = new.company_id and m.user_id is distinct from actor;
  elsif new.product_id is not null then
    insert into notifications (user_id, company_id, type, title, body, link)
    select u.user_id, new.company_id, 'product_' || verb, coalesce(pname, '') || ' — ' || new.title,
           left(new.body, 240), '/app/kb/' || new.product_id
    from (
      select s.user_id from subscriptions s where s.product_id = new.product_id
      union
      select p.owner_id from products p where p.id = new.product_id and p.owner_id is not null
    ) u where u.user_id is distinct from actor;
  end if;
  return new;
end $$;
create trigger entries_notify after insert or update on public.entries
  for each row execute function public.notify_entry_change();

create or replace function public.notify_proposal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, company_id, type, title, body, link)
  select m.user_id, new.company_id, 'proposal',
         case when new.kind = 'conflict' then 'Конфликт источников' else 'Новое предложение изменения' end,
         left(new.summary, 240), '/app/review'
  from company_members m
  where m.company_id = new.company_id and m.role = 'admin';
  return new;
end $$;
create trigger proposals_notify after insert on public.proposals
  for each row execute function public.notify_proposal();

-- ───────────────────────── widoki i wyszukiwanie ─────────────────────────

create or replace view public.products_v with (security_invoker = true) as
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

create or replace function public.match_entries(
  p_company uuid, p_embedding extensions.vector(768), p_query text, p_limit int default 12)
returns table (
  id uuid, product_id uuid, product_name text, type text, title text, body text,
  effective_from date, effective_to date, updated_at timestamptz, source text, status text, score real)
language sql stable set search_path = public, extensions as $$
  select e.id, e.product_id, p.name, e.type, e.title, e.body, e.effective_from, e.effective_to,
         e.updated_at, e.source, e.status,
         (coalesce(1 - (e.embedding <=> p_embedding), 0) * 0.75
          + greatest(word_similarity(p_query, e.title), word_similarity(p_query, coalesce(p.name, ''))) * 0.25)::real as score
  from entries e left join products p on p.id = e.product_id
  where e.company_id = p_company and e.status in ('current', 'review')
    and (p.id is null or p.status <> 'archived')
  order by score desc
  limit p_limit
$$;

-- ───────────────────────── RLS ─────────────────────────

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.collections enable row level security;
alter table public.products enable row level security;
alter table public.entries enable row level security;
alter table public.brand enable row level security;
alter table public.files enable row level security;
alter table public.proposals enable row level security;
alter table public.history enable row level security;
alter table public.subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.digests enable row level security;
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
alter table public.knowledge_gaps enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.ingest_log enable row level security;
alter table public.oauth_states enable row level security;
alter table public.mcp_tokens enable row level security;
alter table public.web_sources enable row level security;
alter table public.platform_settings enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_moderator() or public.shares_company(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy companies_read on public.companies for select to authenticated using (public.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

create policy members_read on public.company_members for select to authenticated using (public.is_member(company_id));

create policy collections_read on public.collections for select to authenticated using (public.is_member(company_id));
create policy collections_write on public.collections for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

create policy products_read on public.products for select to authenticated using (public.is_member(company_id));
create policy products_insert on public.products for insert to authenticated with check (public.is_member(company_id));
create policy products_update on public.products for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy products_delete on public.products for delete to authenticated using (public.is_admin(company_id));

create policy entries_read on public.entries for select to authenticated using (public.is_member(company_id));
create policy entries_insert on public.entries for insert to authenticated with check (public.is_member(company_id));
create policy entries_update on public.entries for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy entries_delete on public.entries for delete to authenticated
  using (public.is_admin(company_id) or created_by = auth.uid());

create policy brand_read on public.brand for select to authenticated using (public.is_member(company_id));
create policy brand_write on public.brand for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

create policy files_read on public.files for select to authenticated using (public.is_member(company_id));
create policy files_insert on public.files for insert to authenticated with check (public.is_member(company_id));
create policy files_update on public.files for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy files_delete on public.files for delete to authenticated
  using (public.is_admin(company_id) or created_by = auth.uid());

create policy proposals_read on public.proposals for select to authenticated
  using (public.is_admin(company_id) or source_user = auth.uid());

create policy history_read on public.history for select to authenticated using (public.is_member(company_id));

create policy subs_all on public.subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from products p where p.id = product_id and public.is_member(p.company_id)));

create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy digests_read on public.digests for select to authenticated using (public.is_member(company_id));

create policy chats_all on public.chats for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(company_id));
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists (select 1 from chats c where c.id = chat_id and c.user_id = auth.uid()));

create policy gaps_read on public.knowledge_gaps for select to authenticated using (public.is_admin(company_id));
create policy gaps_update on public.knowledge_gaps for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

create policy integrations_read on public.integrations for select to authenticated
  using (user_id = auth.uid() or public.is_admin(company_id));

create policy mcp_read on public.mcp_tokens for select to authenticated using (user_id = auth.uid());

create policy web_read on public.web_sources for select to authenticated using (public.is_member(company_id));

-- ───────────────────────── pliki ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 26214400)
on conflict (id) do nothing;

create or replace function public.path_company(p text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_member(public.path_company(name)));
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_member(public.path_company(name)));
create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_member(public.path_company(name)));
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_member(public.path_company(name)));

-- funkcje pomocnicze tylko dla zalogowanych
revoke execute on function public.history_revert(uuid) from anon, public;
grant execute on function public.history_revert(uuid) to authenticated;
revoke execute on function public.match_entries(uuid, extensions.vector, text, int) from anon, public, authenticated;
grant execute on function public.match_entries(uuid, extensions.vector, text, int) to service_role;
