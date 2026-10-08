// Jednorazowa konfiguracja projektu: sekrety funkcji, logowanie bez rejestracji, cron synchronizacji.
import { env, mgmt, sql } from './env.mjs'

const APP_URL = process.env.APP_URL ?? 'https://aurora.fastline.pl'
const base = `https://${env.SUPABASE_REF}.supabase.co`

await mgmt('/secrets', {
  method: 'POST',
  body: JSON.stringify([
    { name: 'BARABASH_AI_KEY', value: env.BARABASH_AI_KEY },
    { name: 'CRON_SECRET', value: env.CRON_SECRET },
    { name: 'TOKEN_KEY', value: env.TOKEN_KEY },
    { name: 'APP_URL', value: APP_URL },
  ]),
})
console.log('✓ secrets')

await mgmt('/config/auth', {
  method: 'PATCH',
  body: JSON.stringify({
    site_url: APP_URL,
    uri_allow_list: `${APP_URL}/**,http://localhost:5173/**,http://127.0.0.1:5173/**`,
    disable_signup: true,
    mailer_autoconfirm: true,
  }),
})
console.log('✓ auth: rejestracja wyłączona')

await sql(`
  do $$ begin
    if exists (select 1 from vault.secrets where name = 'aurora_cron_secret') then
      perform vault.update_secret((select id from vault.secrets where name = 'aurora_cron_secret'), '${env.CRON_SECRET}');
    else
      perform vault.create_secret('${env.CRON_SECRET}', 'aurora_cron_secret');
    end if;
    perform cron.unschedule(jobid) from cron.job where jobname = 'aurora-sync';
    perform cron.schedule('aurora-sync', '*/5 * * * *', $job$
      select net.http_post(
        url := '${base}/functions/v1/sync',
        headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'aurora_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000)
    $job$);
  end $$;`)
console.log('✓ cron aurora-sync co 5 min')
