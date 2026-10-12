-- Publikacje w mediach społecznościowych (Unipile): konta, dostęp do nich, posty i ich cele.
-- Wszystko czyta i zapisuje funkcja `api` — tabele mają RLS bez polityk.

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('linkedin', 'instagram')),
  -- stały identyfikator konta w samej sieci: po nim rozpoznajemy duplikaty
  provider_user_id text not null,
  unipile_id text not null unique,
  name text not null default '',
  handle text,
  -- LinkedIn: strony firmowe, którymi konto zarządza [{ urn, name }]
  organizations jsonb not null default '[]'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'credentials', 'error', 'gone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create table public.social_access (
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- owner = sam zalogował się na to konto; publisher = dostał dostęp od właściciela
  role text not null check (role in ('owner', 'publisher')),
  needs_approval boolean not null default false,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id, company_id)
);
create index on public.social_access (user_id, company_id);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  text text not null default '',
  -- [{ path, mime, name, size }] w buckecie `social`
  media jsonb not null default '[]'::jsonb,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.social_posts (company_id, created_at desc);

create table public.social_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  account_id uuid references public.social_accounts(id) on delete set null,
  provider text not null,
  label text not null default '',
  org_urn text,
  kind text not null default 'feed' check (kind in ('feed', 'story')),
  status text not null default 'scheduled'
    check (status in ('approval', 'scheduled', 'publishing', 'published', 'failed', 'rejected')),
  due_at timestamptz not null default now(),
  locked_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  error text,
  provider_post_id text,
  published_at timestamptz
);
create index on public.social_targets (post_id);
create index on public.social_targets (status, due_at);

alter table public.social_accounts enable row level security;
alter table public.social_access enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_targets enable row level security;

/** Zajmuje cele gotowe do wysłania — dwa równoległe przebiegi nie opublikują tego samego posta dwa razy. */
create or replace function public.claim_social_targets(p_post uuid default null, p_limit int default 5)
returns setof public.social_targets
language sql security definer set search_path = public as $$
  update social_targets t set status = 'publishing', locked_at = now()
  where t.id in (
    select id from social_targets
    where status = 'scheduled' and due_at <= now() and (p_post is null or post_id = p_post)
    order by due_at
    limit p_limit
    for update skip locked
  )
  returning t.*;
$$;
revoke execute on function public.claim_social_targets(uuid, int) from anon, authenticated, public;

-- zdjęcia i wideo do postów: osobny prywatny bucket, bo sieci nie przyjmują WebP, a wideo jest większe niż reszta plików
insert into storage.buckets (id, name, public, file_size_limit)
values ('social', 'social', false, 52428800)
on conflict (id) do nothing;

create policy social_media_read on storage.objects for select to authenticated
  using (bucket_id = 'social' and public.is_member(public.path_company(name)));
create policy social_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'social' and public.is_member(public.path_company(name)));
create policy social_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'social' and public.is_member(public.path_company(name)));
