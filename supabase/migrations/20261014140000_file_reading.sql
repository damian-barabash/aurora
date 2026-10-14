-- Każdy dokument wgrany do AURORA jest od razu czytany przez AI. Status i wynik widać przy pliku.

alter table public.files
  add column ai_status text not null default 'skipped'
    check (ai_status in ('queued', 'reading', 'done', 'empty', 'error', 'skipped')),
  add column ai_result jsonb,
  add column ai_error text,
  add column ai_read_at timestamptz,
  add column ai_started_at timestamptz;

-- dokumenty, które AI umie przeczytać, wchodzą do kolejki (obrazy i logotypy — nie)
create or replace function public.file_readable(p_name text, p_mime text, p_kind text) returns boolean
language sql immutable set search_path = public as $$
  select p_kind in ('document', 'brand')
    and (lower(p_name) ~ '\.(pdf|docx|txt|md|csv|json|html?)$' or coalesce(p_mime, '') like 'text/%')
$$;

create or replace function public.file_queue() returns trigger
language plpgsql set search_path = public as $$
begin
  new.ai_status := case when public.file_readable(new.name, new.mime, new.kind) then 'queued' else 'skipped' end;
  return new;
end $$;
create trigger files_queue before insert on public.files
  for each row execute function public.file_queue();

-- pliki wgrane wcześniej: dokumenty do przeczytania
update public.files set ai_status = 'queued' where public.file_readable(name, mime, kind);

create index files_ai_queue on public.files (ai_status, created_at) where ai_status in ('queued', 'reading');

revoke execute on function public.file_queue() from anon, authenticated, public;
