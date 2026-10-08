-- Interfejs tylko po polsku: teksty powiadomień tworzonych w bazie

create or replace function public.notify_proposal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, company_id, type, title, body, link)
  select m.user_id, new.company_id, 'proposal',
         case when new.kind = 'conflict' then 'Konflikt źródeł' else 'Nowa propozycja zmiany' end,
         left(new.summary, 240), '/app/review'
  from company_members m
  where m.company_id = new.company_id and m.role = 'admin';
  return new;
end $$;

alter table public.profiles drop column locale;
update public.companies set settings = settings - 'language';
