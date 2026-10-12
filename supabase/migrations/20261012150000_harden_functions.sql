-- Uwagi audytu bezpieczeństwa Supabase: stała ścieżka wyszukiwania i brak dostępu anonimowego do funkcji pomocniczych.
alter function public.profiles_guard() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.stamp_created_by() set search_path = public;
alter function public.path_company(text) set search_path = public;

-- funkcje wyzwalaczy nie są do wywoływania przez API
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.log_history() from anon, authenticated, public;
revoke execute on function public.notify_entry_change() from anon, authenticated, public;
revoke execute on function public.notify_proposal() from anon, authenticated, public;

-- pomocnicze funkcje uprawnień: potrzebne politykom RLS zalogowanych, niezalogowanym nie
revoke execute on function public.is_moderator() from anon, public;
revoke execute on function public.is_member(uuid) from anon, public;
revoke execute on function public.is_admin(uuid) from anon, public;
revoke execute on function public.shares_company(uuid) from anon, public;
grant execute on function public.is_moderator(), public.is_member(uuid), public.is_admin(uuid), public.shares_company(uuid) to authenticated, service_role;
