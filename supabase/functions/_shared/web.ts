// Import wiedzy ze strony firmowej: kolejka adresów, hash treści strony, ponowne sprawdzanie raz na dobę.

import { db, sha256 } from './core.ts'
import { stripHtml } from './google.ts'
import { ingestText } from './ingest.ts'

const MAX_PAGES = 24
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mov|css|js|xml|json|ico|woff2?)(\?|$)|\/(wp-admin|wp-json|cart|koszyk|checkout|login|logowanie|panel|admin|tag|author|feed)(\/|$)|polityka|privacy|cookies|regulamin|terms/i

export function safeUrl(raw: string): URL {
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad_url')
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)|\.internal$|\.local$/i.test(u.hostname)) {
    throw new Error('bad_url')
  }
  u.hash = ''
  return u
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'AuroraBot/1.0 (+knowledge base import)', accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return null
    return (await r.text()).slice(0, 600_000)
  } catch {
    return null
  }
}

const norm = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`

async function discover(root: URL): Promise<string[]> {
  const found = new Set<string>([norm(root)])
  const add = (href: string) => {
    try {
      const u = new URL(href, root)
      if (u.hostname.replace(/^www\./, '') !== root.hostname.replace(/^www\./, '')) return
      if (SKIP.test(u.pathname + u.search)) return
      found.add(norm(u))
    } catch { /* zły href */ }
  }
  try {
    const sm = await fetch(`${root.origin}/sitemap.xml`, { signal: AbortSignal.timeout(8000) })
    if (sm.ok) for (const m of (await sm.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) if (!m[1].endsWith('.xml')) add(m[1])
  } catch { /* brak mapy strony */ }
  const html = await fetchPage(root.href)
  if (html) for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) add(m[1])
  // najpierw strony bliżej korzenia: oferta i produkty są zwykle płytko
  return [...found].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length).slice(0, MAX_PAGES)
}

export async function startCrawl(sourceId: string) {
  const { data: src } = await db.from('web_sources').select('*').eq('id', sourceId).single()
  if (!src) return
  try {
    const queue = await discover(safeUrl(src.url))
    await db.from('web_sources').update({ queue, status: 'crawling', last_error: null }).eq('id', sourceId)
  } catch (e) {
    await db.from('web_sources').update({ status: 'error', last_error: e instanceof Error ? e.message : String(e) }).eq('id', sourceId)
  }
}

export async function crawlStep(sourceId: string, maxPages = 2) {
  const { data: src } = await db.from('web_sources').select('*').eq('id', sourceId).single()
  if (!src || !Array.isArray(src.queue) || !src.queue.length) return
  const queue: string[] = [...src.queue]
  const pages: Record<string, string> = { ...src.pages }
  const stats = { pages: 0, facts: 0, proposed: 0, ...src.stats }
  for (const url of queue.splice(0, maxPages)) {
    const html = await fetchPage(url)
    if (!html) continue
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''
    const main = html.replace(/<(nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, ' ')
    const text = stripHtml(main).slice(0, 8000)
    if (text.length < 200) continue
    const hash = await sha256(text)
    if (pages[url] === hash) continue
    const first = !(url in pages)
    const u = new URL(url)
    const res = await ingestText({
      companyId: src.company_id,
      source: 'website',
      label: `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`,
      sourceUser: src.created_by,
      bootstrap: true,
      text: `Company website page. Title: ${title}\nURL: ${url}\n\n${text}`,
    }).catch(() => null)
    if (!res) continue
    pages[url] = hash
    if (first) stats.pages++
    stats.facts += res.applied
    stats.proposed += res.proposed
  }
  await db.from('web_sources').update({
    queue,
    pages,
    stats,
    status: queue.length ? 'crawling' : 'ready',
    last_crawled_at: queue.length ? src.last_crawled_at : new Date().toISOString(),
  }).eq('id', sourceId)
}

/** Raz na dobę wszystkie znane strony wracają do kolejki; niezmienione odpadają po hashu. */
export async function requeueStale() {
  const { data } = await db.from('web_sources').select('id, url, pages').eq('status', 'ready')
    .lt('last_crawled_at', new Date(Date.now() - 24 * 3600_000).toISOString()).limit(5)
  for (const s of data ?? []) {
    const queue = [...new Set([s.url, ...Object.keys(s.pages ?? {})])].slice(0, MAX_PAGES)
    await db.from('web_sources').update({ queue, status: 'crawling' }).eq('id', s.id)
  }
}
