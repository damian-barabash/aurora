// Czytanie dokumentów przez AI: tekst z pliku → fakty w bazie. Status i wynik zapisujemy przy pliku,
// żeby w panelu było widać, czy AI już go przeczytało i co z niego dodało.

import { db } from './core.ts'
import { stripHtml } from './google.ts'
import { ingestText, type ItemResult } from './ingest.ts'

/** Plik uznany za „zawieszony” w czytaniu po tym czasie wraca do kolejki. */
export const STALE_READING_MS = 3 * 60_000
const CHUNK = 8000
const MAX_CHARS = 32_000

// deno-lint-ignore no-explicit-any
async function textOf(file: any): Promise<string> {
  const { data: blob, error } = await db.storage.from('media').download(file.path)
  if (error || !blob) throw new Error('Nie udało się pobrać pliku')
  const name = String(file.name).toLowerCase()
  if (name.endsWith('.pdf') || file.mime === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('npm:unpdf@0.12.1')
    const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()))
    const out = await extractText(pdf, { mergePages: true })
    return Array.isArray(out.text) ? out.text.join('\n') : out.text
  }
  if (name.endsWith('.docx')) {
    const { unzipSync, strFromU8 } = await import('npm:fflate@0.8.2')
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const xml = zip['word/document.xml'] ? strFromU8(zip['word/document.xml']) : ''
    return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) return stripHtml(await blob.text())
  if (/\.(txt|md|csv|json)$/.test(name) || (file.mime ?? '').startsWith('text/')) return await blob.text()
  throw new Error('Tego formatu AI jeszcze nie czyta')
}

export interface ReadResult {
  /** czytanie długiego pliku idzie kawałkami; postęp przeżywa restart funkcji */
  progress?: { done: number; total: number } | null
  applied: number
  proposed: number
  skipped: number
  items: ItemResult[]
  batch_id: string
  chars: number
}

/**
 * Czyta plik i dopisuje wiedzę. `force` = czytaj ponownie także przeczytany plik.
 * Zwraca null, gdy plik czyta już ktoś inny (cron i panel nie robią tego dwa razy).
 */
export async function readFile(fileId: string, opts: { userId?: string | null; force?: boolean; deadline?: number } = {}): Promise<ReadResult | null> {
  const allowed = opts.force ? ['queued', 'done', 'empty', 'error', 'skipped'] : ['queued', 'error']
  const stale = new Date(Date.now() - STALE_READING_MS).toISOString()
  // zajęcie pliku: tylko jeden czytający naraz (zawieszone „reading” wraca po kilku minutach)
  const { data: claimed } = await db.from('files')
    .update({ ai_status: 'reading', ai_started_at: new Date().toISOString(), ai_error: null })
    .eq('id', fileId)
    .or(`ai_status.in.(${allowed.join(',')}),and(ai_status.eq.reading,ai_started_at.lt.${stale})`)
    .select('*').maybeSingle()
  if (!claimed) return null
  const file = claimed
  // przerwane czytanie (koniec czasu funkcji) kontynuujemy od miejsca, w którym stanęło
  const prior = !opts.force && file.ai_result?.progress ? file.ai_result as ReadResult : null
  try {
    const text = (await textOf(file)).replace(/\u0000/g, '').trim()
    if (text.length < 40) {
      await db.from('files').update({ ai_status: 'empty', ai_read_at: new Date().toISOString(), ai_result: { applied: 0, proposed: 0, skipped: 0, items: [], chars: text.length } }).eq('id', file.id)
      return { applied: 0, proposed: 0, skipped: 0, items: [], batch_id: '', chars: text.length }
    }
    let hint: string | null = null
    let brandHint: string | null = file.brand_id ?? null
    if (file.product_id) {
      const { data: p } = await db.from('products').select('name, brand_id').eq('id', file.product_id).maybeSingle()
      hint = p?.name ?? null
      brandHint = p?.brand_id ?? brandHint
    }
    const parts = Math.max(1, Math.ceil(Math.min(text.length, MAX_CHARS) / CHUNK))
    const batchId = prior?.batch_id || crypto.randomUUID()
    const total: ReadResult = prior
      ? { ...prior, chars: text.length }
      : { applied: 0, proposed: 0, skipped: 0, items: [], batch_id: batchId, chars: text.length, progress: { done: 0, total: parts } }
    // długi dokument czytamy w kawałkach (do ~32 tys. znaków), zapisując postęp po każdym
    for (let n = total.progress?.done ?? 0; n < parts; n++) {
      if (opts.deadline && Date.now() > opts.deadline) {
        await db.from('files').update({ ai_status: 'queued', ai_result: total }).eq('id', file.id)
        return total
      }
      const i = n * CHUNK
      const res = await ingestText({
        companyId: file.company_id, source: 'file', label: String(file.name).slice(0, 120),
        sourceUser: opts.userId ?? file.created_by ?? null, text: text.slice(i, i + 8500),
        bootstrap: true, trusted: true, productHint: hint, brandHint, batchId,
      })
      total.applied += res.applied
      total.proposed += res.proposed
      total.skipped += res.skipped
      total.items.push(...res.items.filter((x) => x.outcome !== 'empty'))
      total.progress = { done: n + 1, total: parts }
      await db.from('files').update({ ai_result: { ...total, items: total.items.slice(0, 60) } }).eq('id', file.id)
    }
    total.progress = null
    await db.from('files').update({
      ai_status: total.applied || total.proposed || total.items.length ? 'done' : 'empty',
      ai_read_at: new Date().toISOString(),
      ai_result: { ...total, items: total.items.slice(0, 60) },
    }).eq('id', file.id)
    return total
  } catch (e) {
    await db.from('files').update({ ai_status: 'error', ai_error: (e instanceof Error ? e.message : String(e)).slice(0, 300), ai_read_at: new Date().toISOString() }).eq('id', file.id)
    throw e
  }
}

/** Cron: dokumenty czekające w kolejce (np. gdy ktoś zamknął kartę zaraz po wgraniu). */
export async function readQueuedFiles(deadline: number) {
  const stale = new Date(Date.now() - STALE_READING_MS).toISOString()
  const { data } = await db.from('files').select('id')
    .or(`ai_status.eq.queued,and(ai_status.eq.reading,ai_started_at.lt.${stale})`)
    .order('created_at').limit(3)
  let read = 0
  for (const f of data ?? []) {
    if (Date.now() > deadline) break
    await readFile(f.id, { deadline }).catch((e) => console.error('readFile', f.id, e))
    read++
  }
  return read
}
