// Powrót z ekranu zgody Google: zapis tokenów (zaszyfrowanych) i od razu pierwsza synchronizacja.

import { APP_URL, db, encrypt } from '../_shared/core.ts'
import { exchangeCode, syncIntegration } from '../_shared/google.ts'

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<any>): void }

const back = (to: string, params: Record<string, string>) => {
  const u = new URL(to)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return Response.redirect(u.toString(), 302)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const { data: st } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle()
  if (!st) return back(`${APP_URL}/app/integrations`, { google: 'error', reason: 'state' })
  await db.from('oauth_states').delete().eq('state', state)
  if (url.searchParams.get('error')) return back(st.return_to, { google: 'error', reason: url.searchParams.get('error')! })

  try {
    const tok = await exchangeCode(url.searchParams.get('code') ?? '')
    let email: string | null = null
    try {
      email = JSON.parse(atob(tok.id_token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null
    } catch { /* brak id_token */ }

    const { data: integ, error } = await db.from('integrations').upsert({
      user_id: st.user_id,
      company_id: st.company_id,
      provider: 'google',
      account_email: email,
      scopes: tok.scope,
      status: 'active',
      last_error: null,
    }, { onConflict: 'user_id,company_id,provider' }).select('id').single()
    if (error) throw new Error(error.message)

    const { data: old } = await db.from('integration_secrets').select('refresh_token').eq('integration_id', integ.id).maybeSingle()
    if (!tok.refresh_token && !old) throw new Error('no_refresh_token')
    await db.from('integration_secrets').upsert({
      integration_id: integ.id,
      refresh_token: tok.refresh_token ? await encrypt(tok.refresh_token) : old!.refresh_token,
      access_token: await encrypt(tok.access_token),
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    })
    EdgeRuntime.waitUntil(syncIntegration(integ.id, 4, true))
    return back(st.return_to, { google: 'connected' })
  } catch (e) {
    return back(st.return_to, { google: 'error', reason: e instanceof Error ? e.message.slice(0, 80) : 'unknown' })
  }
})
