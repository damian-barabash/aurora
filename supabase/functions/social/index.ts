// Dwa wejścia bez sesji użytkownika:
//   /social/notify — Unipile zgłasza, że ktoś zalogował się na konto (name = nasz jednorazowy stan)
//   /social/cron   — pg_cron co minutę: zaplanowane posty, przerwane publikacje, stan kont

import { db, json } from '../_shared/core.ts'
import { adoptAccount, failStuck, runDue, syncAccounts } from '../_shared/social.ts'

Deno.serve(async (req) => {
  const route = new URL(req.url).pathname.split('/').pop()

  if (route === 'notify' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const state = String(body.name ?? '')
    const { data: st } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle()
    if (!st || !state.startsWith('soc_') || !body.account_id) return json({ error: 'forbidden' }, 403)
    try {
      const res = await adoptAccount(String(body.account_id), st.user_id, st.company_id)
      await db.from('oauth_states').delete().eq('state', state)
      return json({ ok: true, ...res })
    } catch (e) {
      console.error('social notify', e)
      return json({ error: String(e) }, 500)
    }
  }

  if (route === 'cron') {
    if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'forbidden' }, 403)
    const started = Date.now()
    await failStuck()
    const sent = await runDue(null, started + 120_000)
    // stan kont wystarczy sprawdzać co 10 minut
    const accounts = new Date().getMinutes() % 10 === 0 ? await syncAccounts().catch(() => -1) : null
    return json({ ok: true, sent, accounts, ms: Date.now() - started })
  }

  return json({ error: 'not_found' }, 404)
})
