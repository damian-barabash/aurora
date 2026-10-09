// Google Workspace: Gmail + Kalendarz, tylko odczyt. Treść maili nie jest zapisywana.

import { db, decrypt, encrypt, FUNCTIONS_URL, getSetting } from './core.ts'
import { ingestText } from './ingest.ts'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

export const REDIRECT_URI = `${FUNCTIONS_URL}/google-callback`

export async function googleClient(): Promise<{ id: string; secret: string } | null> {
  const [id, secret] = await Promise.all([getSetting('google_client_id'), getSetting('google_client_secret')])
  if (!id || !secret) return null
  return { id, secret: await decrypt(secret) }
}

export async function exchangeCode(code: string) {
  const client = await googleClient()
  if (!client) throw new Error('google_not_configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error_description ?? d.error ?? 'token_exchange_failed')
  return d as { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string }
}

async function accessToken(integrationId: string): Promise<string> {
  const { data: s } = await db.from('integration_secrets').select('*').eq('integration_id', integrationId).single()
  if (!s) throw new Error('no_tokens')
  if (s.access_token && s.expires_at && new Date(s.expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(s.access_token)
  }
  const client = await googleClient()
  if (!client) throw new Error('google_not_configured')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: await decrypt(s.refresh_token),
      client_id: client.id,
      client_secret: client.secret,
      grant_type: 'refresh_token',
    }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error === 'invalid_grant' ? 'access_revoked' : d.error ?? 'refresh_failed')
  await db.from('integration_secrets').update({
    access_token: await encrypt(d.access_token),
    expires_at: new Date(Date.now() + d.expires_in * 1000).toISOString(),
  }).eq('integration_id', integrationId)
  return d.access_token
}

async function gapi<T>(token: string, url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

const b64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export const stripHtml = (html: string) =>
  html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()

// deno-lint-ignore no-explicit-any
function bodyOf(payload: any): string {
  let plain = ''
  let html = ''
  // deno-lint-ignore no-explicit-any
  const walk = (part: any) => {
    if (!part) return
    if (part.filename) return
    if (part.mimeType === 'text/plain' && part.body?.data && !plain) plain = b64(part.body.data)
    if (part.mimeType === 'text/html' && part.body?.data && !html) html = b64(part.body.data)
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return plain || stripHtml(html)
}

/** Usuwa cytowaną historię wątku i stopki — modelowi wystarczy nowa treść. */
function trimQuoted(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^(On .+ wrote:|W dniu .+ (pisze|napisał\(a\)|napisał|napisała):|.+ пишет:|-{2,}\s*(Original Message|Forwarded message|Wiadomość oryginalna).*)$/i.test(line.trim())) break
    out.push(line)
  }
  return out.join('\n').trim()
}

interface Integration {
  id: string
  user_id: string
  company_id: string
  cursor: { mail_after?: number; calendar_at?: number }
  stats: Record<string, number>
}

export async function syncIntegration(integrationId: string, maxMails = 5) {
  const { data: integ } = await db.from('integrations').select('id, user_id, company_id, cursor, stats').eq('id', integrationId).single()
  if (!integ) return
  // druga synchronizacja tej samej skrzynki w tym samym czasie = te same maile dwa razy
  const { data: claimed } = await db.rpc('claim_integration', { p_id: integrationId })
  if (!claimed) return
  const it = integ as Integration
  const { data: prof } = await db.from('profiles').select('full_name, email').eq('id', it.user_id).single()
  const who = prof?.full_name || prof?.email || ''
  const stats = { mails: 0, facts: 0, proposed: 0, ...it.stats }
  const cursor = { ...it.cursor }
  try {
    const token = await accessToken(it.id)

    // ── poczta ──
    const after = cursor.mail_after ?? Math.floor(Date.now() / 1000) - 7 * 86400
    const q = encodeURIComponent(`after:${after} -category:promotions -category:social -category:forums -in:chats`)
    const ids: string[] = []
    let pageToken = ''
    for (let page = 0; page < 3; page++) {
      const list = await gapi<{ messages?: { id: string }[]; nextPageToken?: string }>(
        token,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      )
      ids.push(...(list.messages ?? []).map((m) => m.id))
      if (!list.nextPageToken) break
      pageToken = list.nextPageToken
    }
    const { data: done } = ids.length
      ? await db.from('ingest_log').select('external_id').eq('integration_id', it.id).in('external_id', ids.map((i) => `m:${i}`))
      : { data: [] }
    const seen = new Set((done ?? []).map((d) => d.external_id))
    const todo = ids.filter((i) => !seen.has(`m:${i}`)).reverse()
    for (const id of todo.slice(0, maxMails)) {
      let outcome = 'empty'
      try {
        // deno-lint-ignore no-explicit-any
        const msg = await gapi<any>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`)
        // deno-lint-ignore no-explicit-any
        const h = (name: string) => msg.payload?.headers?.find((x: any) => x.name.toLowerCase() === name)?.value ?? ''
        const from = h('from')
        const automated = h('list-unsubscribe') || /auto-generated|auto-replied/i.test(h('auto-submitted')) ||
          /no-?reply|noreply|mailer-daemon|notifications?@|newsletter/i.test(from)
        if (automated) outcome = 'automated'
        else {
          const body = trimQuoted(bodyOf(msg.payload)).slice(0, 6000)
          if (body.length >= 60) {
            const res = await ingestText({
              companyId: it.company_id,
              source: 'email',
              label: `Gmail · ${who}`,
              sourceUser: it.user_id,
              text: `Subject: ${h('subject')}\nDate: ${h('date')}\n\n${body}`,
            })
            stats.facts += res.applied
            stats.proposed += res.proposed
            outcome = `a${res.applied} p${res.proposed}`
          }
        }
      } catch (e) {
        outcome = `error: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`
      }
      stats.mails++
      await db.from('ingest_log').upsert({ integration_id: it.id, external_id: `m:${id}`, outcome })
    }
    // wszystko z okna przerobione → przesuwamy okno, żeby lista nie rosła
    if (todo.length <= maxMails) cursor.mail_after = Math.floor(Date.now() / 1000) - 3600

    // ── kalendarz: raz na 6 godzin ──
    if (!cursor.calendar_at || Date.now() - cursor.calendar_at > 6 * 3600_000) {
      const from = new Date().toISOString()
      const to = new Date(Date.now() + 120 * 86400_000).toISOString()
      // deno-lint-ignore no-explicit-any
      const cal = await gapi<{ items?: any[] }>(
        token,
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=60&timeMin=${from}&timeMax=${to}`,
      )
      const events = (cal.items ?? []).filter((e) => e.status !== 'cancelled' && e.visibility !== 'private' && e.visibility !== 'confidential' && e.summary)
      const keys = events.map((e) => `c:${e.id}:${e.updated}`)
      const { data: known } = keys.length
        ? await db.from('ingest_log').select('external_id').eq('integration_id', it.id).in('external_id', keys)
        : { data: [] }
      const knownSet = new Set((known ?? []).map((k) => k.external_id))
      const fresh = events.filter((e) => !knownSet.has(`c:${e.id}:${e.updated}`)).slice(0, 25)
      if (fresh.length) {
        const text = fresh.map((e) => {
          const start = e.start?.date ?? e.start?.dateTime ?? ''
          const end = e.end?.date ?? e.end?.dateTime ?? ''
          const desc = e.description ? ` — ${stripHtml(String(e.description)).slice(0, 300)}` : ''
          return `- ${start} → ${end}: ${e.summary}${e.location ? ` (${e.location})` : ''}${desc}`
        }).join('\n')
        const res = await ingestText({
          companyId: it.company_id,
          source: 'calendar',
          label: `Google Calendar · ${who}`,
          sourceUser: it.user_id,
          text: `Calendar events of an employee. Keep ONLY events that are company product events, launches, trainings, deadlines or public dates. ` +
            `Private meetings, 1:1s, calls, lunches, personal reminders → private.\n${text}`,
        })
        stats.facts += res.applied
        stats.proposed += res.proposed
        await db.from('ingest_log').upsert(fresh.map((e) => ({ integration_id: it.id, external_id: `c:${e.id}:${e.updated}`, outcome: 'calendar' })))
      }
      cursor.calendar_at = Date.now()
    }

    await db.from('integrations').update({
      status: 'active', last_error: null, last_sync_at: new Date().toISOString(), cursor, stats, locked_until: null,
    }).eq('id', it.id)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from('integrations').update({
      status: message === 'access_revoked' ? 'revoked' : 'error',
      last_error: message.slice(0, 300),
      last_sync_at: new Date().toISOString(),
      stats,
      locked_until: null,
    }).eq('id', it.id)
  }
}
