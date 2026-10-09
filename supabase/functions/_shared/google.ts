// Google Workspace: Gmail + Kalendarz, tylko odczyt. Treść maili nie jest zapisywana.

import { db, decrypt, encrypt, FUNCTIONS_URL, getSetting, sha256, today } from './core.ts'
import { chatJSON, embed, toVector } from './ai.ts'
import { embedEntries, ingestText } from './ingest.ts'

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

// ───────────────────────── kalendarz ─────────────────────────

const CAL_SYSTEM = `You sort calendar events of an employee for the company knowledge base (AURORA). The base keeps dates the whole team should know.
For every event return its kind:
- "business": anything from the company's offer or plans that matters to the team or clients — trainings, track days, events, trips and expeditions, races and championships the company attends or organises, fairs, launches, campaigns, deadlines, deliveries, public dates. Short or cryptic titles, abbreviations and code names still count when the calendar name, location or products suggest company activity. When in doubt between "business" and "unsure", events from a dedicated (non-primary) calendar are "business".
- "internal": routine internal meetings — statuses, stand-ups, weekly syncs, 1:1s, calls, interviews, reviews.
- "private": personal life — doctor, family, holidays of the person, private reminders.
- "unsure": cannot tell.
"product": the exact name from PRODUCTS when the event clearly belongs to one (match by full name, part of the name, the abbreviation in brackets, or an obvious synonym / location / theme from the summary); otherwise null. Do not force a product.
"title": a clear title for the team in Polish. Keep proper names exactly (WEC, Monza, Barcelona). Expand an abbreviation only when you are certain; fix letter case ("WEC monza" → "WEC Monza").
"note": one short Polish sentence saying what this is, only if you actually know (e.g. what the abbreviation stands for); otherwise "".
Return ONLY JSON: {"events":[{"n":1,"kind":"business","product":null,"title":"","note":""}]}`

const acronym = (name: string) => name.split(/[\s\-]+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).join('').toUpperCase()
const plDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/**
 * Kalendarz to dane, nie tekst: daty bierzemy wprost z wydarzenia, a model tylko ocenia, czy to sprawa firmy,
 * do którego produktu należy i jak je czytelnie nazwać. Czytamy wszystkie własne kalendarze, nie tylko główny.
 * Wpis jest związany z wydarzeniem (source_meta.event_id): przesunięcie terminu aktualizuje wpis, odwołanie go archiwizuje.
 */
async function syncCalendar(it: Integration, token: string, who: string): Promise<{ applied: number; proposed: number }> {
  const out = { applied: 0, proposed: 0 }
  // deno-lint-ignore no-explicit-any
  const list = await gapi<{ items?: any[] }>(token, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer')
  const calendars = (list.items ?? []).filter((c) => !c.deleted && c.selected !== false && !/#(holiday|contacts|weather)@/.test(c.id))
  const from = new Date().toISOString()
  const to = new Date(Date.now() + 240 * 86400_000).toISOString()
  // deno-lint-ignore no-explicit-any
  const events: any[] = []
  for (const cal of calendars.slice(0, 8)) {
    // deno-lint-ignore no-explicit-any
    const res = await gapi<{ items?: any[] }>(
      token,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&showDeleted=true&orderBy=startTime&maxResults=120&timeMin=${from}&timeMax=${to}`,
    ).catch(() => ({ items: [] }))
    const seenSeries = new Set<string>()
    for (const e of res.items ?? []) {
      if (e.visibility === 'private' || e.visibility === 'confidential') continue
      if (e.status !== 'cancelled' && !e.summary) continue
      // z cyklu bierzemy tylko najbliższe wystąpienie
      if (e.recurringEventId) {
        if (seenSeries.has(e.recurringEventId)) continue
        seenSeries.add(e.recurringEventId)
      }
      events.push({ ...e, _calendar: cal.primary ? null : cal.summaryOverride ?? cal.summary, _recurring: !!e.recurringEventId })
    }
  }

  // odwołane wydarzenia: wpis do archiwum
  for (const e of events.filter((x) => x.status === 'cancelled')) {
    await db.from('entries').update({ status: 'archived', updated_by: it.user_id }).eq('company_id', it.company_id)
      .eq('source', 'calendar').eq('source_meta->>event_id', e.id).neq('status', 'archived')
  }

  const live = events.filter((e) => e.status !== 'cancelled')
  const keyOf = (e: { id: string; updated?: string }) => `c:${e.id}:${e.updated ?? ''}`
  const { data: known } = live.length
    ? await db.from('ingest_log').select('external_id').eq('integration_id', it.id).in('external_id', live.map(keyOf))
    : { data: [] }
  const knownSet = new Set((known ?? []).map((k) => k.external_id))
  const fresh = live.filter((e) => !knownSet.has(keyOf(e))).slice(0, 30)
  if (!fresh.length) return out

  const [{ data: company }, { data: products }] = await Promise.all([
    db.from('companies').select('name, settings').eq('id', it.company_id).single(),
    db.from('products').select('id, name, summary').eq('company_id', it.company_id).neq('status', 'archived'),
  ])
  const day = (x: { date?: string; dateTime?: string } | undefined) => (x?.date ?? x?.dateTime ?? '').slice(0, 10)
  const user = [
    `TODAY: ${today()}`,
    `COMPANY: ${company?.name}`,
    `PRODUCTS:\n${(products ?? []).map((p) => `- ${p.name} [${acronym(p.name)}]${p.summary ? ` — ${p.summary.slice(0, 140)}` : ''}`).join('\n') || '(none)'}`,
    `EVENTS:\n${fresh.map((e, i) => {
      const desc = e.description ? ` | opis: ${stripHtml(String(e.description)).slice(0, 240)}` : ''
      return `${i + 1}. "${e.summary}" | ${day(e.start)} → ${day(e.end)} | kalendarz: ${e._calendar ?? 'główny'}${e._recurring ? ' | cykliczne' : ''}` +
        `${e.location ? ` | miejsce: ${String(e.location).slice(0, 80)}` : ''}${e.attendees ? ` | uczestnicy: ${e.attendees.length}` : ''}${desc}`
    }).join('\n')}`,
  ].join('\n\n')
  const parsed = await chatJSON<{ events: { n: number; kind: string; product: string | null; title: string; note: string }[] }>(CAL_SYSTEM, user, 2400)
  const verdicts = new Map((parsed?.events ?? []).map((v) => [Number(v.n), v]))
  if (!verdicts.size) return out // model nie odpowiedział: spróbujemy przy następnym przebiegu

  const productByName = new Map((products ?? []).map((p) => [p.name.trim().toLowerCase(), p.id as string]))
  const autoApply = company?.settings?.auto_apply !== false
  const touched: string[] = []
  for (const [i, e] of fresh.entries()) {
    const v = verdicts.get(i + 1)
    const kind = v?.kind ?? 'unsure'
    if (kind === 'business' || kind === 'unsure') {
      const allDay = !!e.start?.date
      const start = day(e.start)
      // w wydarzeniach całodniowych Google podaje dzień po zakończeniu
      let end = day(e.end) || start
      if (allDay && end > start) end = new Date(Date.parse(`${end}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10)
      const title = String(v?.title || e.summary).trim().slice(0, 160)
      const time = !allDay && e.start?.dateTime ? `, godz. ${new Date(e.start.dateTime).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: e.start.timeZone ?? 'Europe/Warsaw' })}` : ''
      const body = [
        `${title}: ${start === end ? plDate(start) : `${plDate(start)} – ${plDate(end)}`}${time}.`,
        e._calendar ? `Kalendarz firmowy „${e._calendar}”.` : '',
        e.location ? `Miejsce: ${String(e.location).slice(0, 160)}.` : '',
        v?.note ? String(v.note).slice(0, 240) : '',
        e.description ? stripHtml(String(e.description)).slice(0, 400) : '',
      ].filter(Boolean).join(' ')
      const productId = v?.product ? productByName.get(String(v.product).trim().toLowerCase()) ?? null : null
      const label = `Kalendarz${e._calendar ? ` „${e._calendar}”` : ''} · ${who}`
      const fields = { type: 'date', title, body, effective_from: start, effective_to: end, importance: 1 }
      const meta = { event_id: e.id, calendar: e._calendar ?? 'primary' }

      const { data: linked } = await db.from('entries').select('id, source').eq('company_id', it.company_id)
        .eq('source_meta->>event_id', e.id).neq('status', 'archived').limit(1)
      if (linked?.length) {
        // termin lub nazwa zmieniły się w kalendarzu; wpisu poprawionego ręcznie nie ruszamy
        if (linked[0].source === 'calendar') {
          await db.from('entries').update({ ...fields, product_id: productId, updated_by: it.user_id, verified_at: new Date().toISOString() }).eq('id', linked[0].id)
          touched.push(linked[0].id)
          out.applied++
        }
      } else if (kind === 'business' && autoApply) {
        // ten sam termin mógł już przyjść z poczty — wtedy tylko wiążemy go z wydarzeniem
        const [vec] = await embed([`${v?.product ? v.product + '. ' : ''}${title}. ${body}`], 'document')
        const { data: near } = await db.rpc('nearest_entries', { p_company: it.company_id, p_embedding: toVector(vec), p_limit: 3 })
        // deno-lint-ignore no-explicit-any
        const twin = ((near ?? []) as any[]).find((h) => h.type === 'date' && h.cos >= 0.88 && h.effective_from === start)
        if (twin) await db.from('entries').update({ verified_at: new Date().toISOString() }).eq('id', twin.id)
        else {
          const { data: created } = await db.from('entries').insert({
            company_id: it.company_id, product_id: productId, ...fields, source: 'calendar', source_label: label, source_meta: meta,
            confidence: 0.9, created_by: it.user_id, updated_by: it.user_id, verified_at: new Date().toISOString(),
          }).select('id').single()
          if (created) {
            touched.push(created.id)
            out.applied++
          }
        }
      } else {
        const { error } = await db.from('proposals').insert({
          company_id: it.company_id, kind: 'new', source: 'calendar', source_label: label, source_user: it.user_id, product_id: productId,
          payload: { ...fields, new_product: null }, summary: title, confidence: kind === 'business' ? 0.9 : 0.5,
          evidence: 'Wydarzenie z kalendarza — nie było jasne, czy dotyczy całej firmy.',
          dedupe_key: await sha256(`cal|${e.id}`),
        })
        if (!error) out.proposed++
      }
    }
    await db.from('ingest_log').upsert({ integration_id: it.id, external_id: keyOf(e), outcome: `calendar:${kind}` })
  }
  if (touched.length) await embedEntries(touched).catch((err) => console.error('embed', err))
  return out
}

/** `deadline` — do kiedy wolno pracować: funkcja edge ma twardy limit czasu, a jeden mail to nawet 25 s pracy modelu. */
export async function syncIntegration(integrationId: string, maxMails = 5, force = false, deadline = Date.now() + 100_000) {
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

    // ── kalendarz: co godzinę albo na żądanie ──
    if (force || !cursor.calendar_at || Date.now() - cursor.calendar_at > 3600_000) {
      const res = await syncCalendar(it, token, who)
      stats.facts += res.applied
      stats.proposed += res.proposed
      cursor.calendar_at = Date.now()
    }

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
    let handled = 0
    for (const id of todo.slice(0, maxMails)) {
      if (Date.now() > deadline - 30_000) break
      handled++
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
    if (handled >= todo.length) cursor.mail_after = Math.floor(Date.now() / 1000) - 3600

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
