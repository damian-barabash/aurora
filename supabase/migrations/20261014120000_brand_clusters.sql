-- Kategorie marek jako osobny byt: tworzenie, zmiana nazwy, kolejność i usuwanie w każdej firmie.
-- brands.cluster zostaje jako kopia nazwy (pilnuje jej trigger), żeby potok faktów i czat działały bez zmian.

create table public.brand_clusters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create index on public.brand_clusters (company_id, position);

alter table public.brand_clusters enable row level security;
create policy brand_clusters_read on public.brand_clusters for select to authenticated using (public.is_member(company_id));
create policy brand_clusters_write on public.brand_clusters for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

alter table public.brands add column cluster_id uuid references public.brand_clusters(id) on delete set null;

insert into public.brand_clusters (company_id, name, position)
select company_id, cluster, min(position) from public.brands where cluster <> '' group by company_id, cluster;
update public.brands b set cluster_id = c.id from public.brand_clusters c where c.company_id = b.company_id and c.name = b.cluster;

-- nazwa kategorii w marce zawsze zgodna z kategorią
create or replace function public.brand_cluster_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cluster_id is null then
    new.cluster := '';
  else
    select c.name into new.cluster from brand_clusters c where c.id = new.cluster_id and c.company_id = new.company_id;
    if not found then raise exception 'cluster_from_other_company'; end if;
  end if;
  return new;
end $$;
create trigger brands_cluster_name before insert or update of cluster_id, cluster, company_id on public.brands
  for each row execute function public.brand_cluster_name();

create or replace function public.cluster_renamed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update brands set cluster = new.name where cluster_id = new.id;
  return new;
end $$;
create trigger brand_clusters_renamed after update of name on public.brand_clusters
  for each row execute function public.cluster_renamed();

revoke execute on function public.brand_cluster_name() from anon, authenticated, public;
revoke execute on function public.cluster_renamed() from anon, authenticated, public;
