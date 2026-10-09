// Wywoływana przez pg_cron co 5 minut: poczta i kalendarz, kolejka stron WWW, brakujące embeddingi, poranny dajdżest.

import { db, json } from '../_shared/core.ts'
import { generateDigest } from '../_shared/digest.ts'
import { syncIntegration } from '../_shared/google.ts'
import { embedEntries } from '../_shared/ingest.ts'
import { crawlStep, requeueStale, startCrawl } from '../_shared/web.ts'

const BUDGET_MS = 110_000

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'forbidden' }, 403)
  const started = Date.now()
  const left = () => BUDGET_MS - (Date.now() - started)
  const report: Record<string, unknown> = {}

  try {
    const { data: missing } = await db.from('entries').select('id').is('embedding', null).neq('status', 'archived').limit(40)
    if (missing?.length) await embedEntries(missing.map((e) => e.id))
    report.embedded = missing?.length ?? 0
  } catch (e) {
    report.embed_error = String(e)
  }

  // poczta: najdawniej synchronizowane konta w pierwszej kolejności
  const { data: integrations } = await db.from('integrations').select('id').in('status', ['active', 'error'])
    .order('last_sync_at', { ascending: true, nullsFirst: true }).limit(3)
  let synced = 0
  for (const it of integrations ?? []) {
    if (left() < 60_000) break
    await syncIntegration(it.id, 4, false, started + BUDGET_MS - 5_000)
    synced++
  }
  report.integrations = synced

  // strony WWW
  await requeueStale()
  const { data: sources } = await db.from('web_sources').select('id, status').in('status', ['queued', 'crawling']).limit(2)
  for (const s of sources ?? []) {
    if (left() < 40_000) break
    if (s.status === 'queued') await startCrawl(s.id)
    await crawlStep(s.id, 2)
  }
  report.sites = sources?.length ?? 0

  // dajdżest po 7:00 czasu warszawskiego
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(new Date()))
  if (hour >= 7 && hour < 12 && left() > 30_000) {
    const { data: companies } = await db.from('companies').select('id')
    let made = 0
    for (const c of companies ?? []) {
      if (left() < 25_000) break
      if (await generateDigest(c.id).catch(() => null)) made++
    }
    report.digests = made
  }

  return json({ ok: true, ms: Date.now() - started, ...report })
})
