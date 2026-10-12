-- Facebook: strony publikują przez własną aplikację Meta (Unipile nie publikuje na Facebooku).
alter table public.social_accounts drop constraint social_accounts_provider_check;
alter table public.social_accounts add constraint social_accounts_provider_check
  check (provider in ('linkedin', 'instagram', 'facebook'));
-- zaszyfrowany token strony; konta Unipile go nie mają
alter table public.social_accounts add column secret text;
