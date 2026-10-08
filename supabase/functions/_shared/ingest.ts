// Wspólny potok: dowolny tekst (mail, kalendarz, strona, plik, Claude) → fakty w bazie wiedzy.
// Surowy tekst źródła nigdzie nie jest zapisywany — do bazy trafia tylko to, co model uznał za wiedzę firmową.

import { chatJSON, embed, toVector } from './ai.ts'
import { db, sha256, today } from './core.ts'

export type Source = 'email' | 'calendar' | 'claude' | 'website' | 'file' | 'chat' | 'manual'

export interface IngestInput {
  companyId: string
  source: Source
  text: string
  label?: string
  sourceUser?: string | null
  /** strona firmowa, plik lub ręczny import: produkty zakładamy od razu, bez kolejki */
  bootstrap?: boolean
  /** użytkownik sam potwierdził (Claude): pomijamy próg pewności */
  trusted?: boolean
  /** nic nie stosujemy automatycznie — wszystko idzie do «Требуют проверки» */
  reviewOnly?: boolean
  productHint?: string | null
}

export interface IngestResult {
  applied: number
  proposed: number
  skipped: number
  titles: string[]
}

interface Item {
  product: string | null
  product_summary?: string
  type: string
  title: string
  body: string
  effective_from: string | null
  effective_to: string | null
  importance: number
  confirmed: boolean
  private: boolean
  confidence: number
  relation: 'new' | 'update' | 'conflict' | 'duplicate'
  existing: string | null
  evidence: string
}

const TYPES = ['fact', 'price', 'date', 'news', 'announcement', 'faq', 'link']
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

const SYSTEM = `You maintain AURORA — a company knowledge base about its PRODUCTS, services, events, prices, dates, brand and official announcements.
You receive a piece of text from a source (email, calendar, website, document, assistant) and must extract ONLY knowledge that belongs in a company-wide knowledge base.

STRICT PRIVACY RULES — set "private": true (the item will be dropped) for anything that is:
- personal or private life, health, family, salaries, HR matters, performance of people, conflicts, gossip
- client personal data, individual orders/complaints of a named private person, invoices, bank data, passwords, access codes
- internal negotiations still in progress, opinions, drafts, questions without an answer
Never copy email addresses, phone numbers of private people, greetings or signatures. Never quote the source — restate neutrally.

WHAT TO EXTRACT: product descriptions and features, prices and price changes, dates/terms/deadlines of events and launches, availability, conditions, official company announcements, changes in the offer, brand rules.
"confirmed": true only when the text states a decision/fact definitively (e.g. "we confirm", "from 1 Nov the price is", published on the company website). Proposals, plans "maybe", questions → false.
"importance": 0 trivial, 1 normal, 2 important for the whole team, 3 critical/urgent announcement.
"type": one of fact | price | date | news | announcement | faq | link. Use "announcement" for a message addressed to the whole team, "news" for something that happened.
"relation" compares with EXISTING ENTRIES listed in the input:
- "duplicate": the base already says the same → give "existing" id
- "update": the same subject, the new text definitively replaces the old value → give "existing" id
- "conflict": the same subject but a different value and it is NOT clear which one is right → give "existing" id
- "new": nothing similar exists
"product": exact name from PRODUCTS when the item is about one of them; a short new product name when the text clearly describes a company product that is not on the list (add "product_summary", one sentence); null for general company knowledge.
"title": short (max 80 chars), specific. "body": 1–4 full sentences with all concrete values (numbers, currency, dates). Write title, body and evidence in Polish (keep product names and proper nouns unchanged).
"evidence": one neutral sentence explaining where this comes from, WITHOUT names of private people and without quoting.
Dates as YYYY-MM-DD. If the year is missing, choose the nearest future date relative to TODAY.

Return ONLY JSON: {"items":[{"product":string|null,"product_summary":string,"type":string,"title":string,"body":string,"effective_from":string|null,"effective_to":string|null,"importance":0,"confirmed":true,"private":false,"confidence":0.0,"relation":"new","existing":string|null,"evidence":string}]}
If there is nothing worth storing return {"items":[]}. Most private emails contain nothing — that is the expected answer.`

export async function embedEntries(ids: string[]) {
  if (!ids.length) return
  const { data } = await db.from('entries').select('id, title, body, product:products(name)').in('id', ids)
  if (!data?.length) return
  // deno-lint-ignore no-explicit-any
  const texts = data.map((e: any) => `${e.product?.name ? e.product.name + '. ' : ''}${e.title}. ${e.body}`)
  const vectors = await embed(texts, 'document')
  await Promise.all(data.map((e, i) => db.from('entries').update({ embedding: toVector(vectors[i]) }).eq('id', e.id)))
}

export async function ingestText(input: IngestInput): Promise<IngestResult> {
  const result: IngestResult = { applied: 0, proposed: 0, skipped: 0, titles: [] }
  const text = input.text.replace(/\s+\n/g, '\n').trim().slice(0, 9000)
  if (text.length < 40) return result

  const [{ data: company }, { data: products }] = await Promise.all([
    db.from('companies').select('name, settings').eq('id', input.companyId).single(),
    db.from('products').select('id, name, summary').eq('company_id', input.companyId).neq('status', 'archived'),
  ])
  if (!company) return result
  const autoApply = !input.reviewOnly && company.settings?.auto_apply !== false

  const [queryVec] = await embed([text.slice(0, 2000)], 'query')
  const { data: similar } = await db.rpc('match_entries', {
    p_company: input.companyId,
    p_embedding: toVector(queryVec),
    p_query: text.slice(0, 200),
    p_limit: 10,
  })
  // deno-lint-ignore no-explicit-any
  const existing = ((similar ?? []) as any[]).filter((e) => e.score > 0.35)
  const refs = new Map(existing.map((e, i) => [`E${i + 1}`, e]))

  const user = [
    `TODAY: ${today()}`,
    `COMPANY: ${company.name}`,
    `SOURCE: ${input.source}`,
    input.productHint ? `THE TEXT IS ABOUT PRODUCT: ${input.productHint}` : '',
    `PRODUCTS:\n${(products ?? []).map((p) => `- ${p.name}${p.summary ? ` — ${p.summary.slice(0, 140)}` : ''}`).join('\n') || '(none yet)'}`,
    `EXISTING ENTRIES:\n${[...refs].map(([ref, e]) => `${ref} [${e.product_name ?? 'company'}] ${e.title}: ${String(e.body).slice(0, 300)}`).join('\n') || '(none)'}`,
    `TEXT:\n"""\n${text}\n"""`,
  ].filter(Boolean).join('\n\n')

  const parsed = await chatJSON<{ items: Item[] }>(SYSTEM, user, 2200)
  const items = Array.isArray(parsed?.items) ? parsed!.items.slice(0, 12) : []
  const productByName = new Map((products ?? []).map((p) => [p.name.trim().toLowerCase(), p.id as string]))
  const touched: string[] = []

  for (const it of items) {
    if (!it || typeof it.title !== 'string' || !it.title.trim() || it.private) {
      result.skipped++
      continue
    }
    const ref = it.existing ? refs.get(String(it.existing).trim()) : null
    const relation = ref ? it.relation : 'new'
    if (relation === 'duplicate' && ref) {
      // to samo potwierdzone z nowego źródła = wpis nadal aktualny
      await db.from('entries').update({ verified_at: new Date().toISOString() }).eq('id', ref.id)
      result.skipped++
      continue
    }

    const fields = {
      type: TYPES.includes(it.type) ? it.type : 'fact',
      title: it.title.trim().slice(0, 160),
      body: String(it.body ?? '').trim().slice(0, 2000),
      effective_from: isDate(it.effective_from) ? it.effective_from : null,
      effective_to: isDate(it.effective_to) ? it.effective_to : null,
      importance: Math.min(3, Math.max(0, Math.round(Number(it.importance) || 1))),
    }
    const confidence = Math.min(1, Math.max(0, Number(it.confidence) || 0.5))
    const evidence = String(it.evidence ?? '').slice(0, 300)
    const stamp = {
      source: input.source,
      source_label: input.label ?? null,
      confidence,
      updated_by: input.sourceUser ?? null,
      verified_at: new Date().toISOString(),
    }

    let productId: string | null = ref?.product_id ?? null
    const productName = it.product?.trim() || input.productHint || null
    let newProduct: { name: string; summary: string } | null = null
    if (!productId && productName) {
      productId = productByName.get(productName.toLowerCase()) ?? null
      if (!productId) newProduct = { name: productName.slice(0, 80), summary: String(it.product_summary ?? '').slice(0, 300) }
    }

    const sure = input.trusted || (it.confirmed && confidence >= 0.7)
    const direct = autoApply && sure && relation !== 'conflict' && (!newProduct || input.bootstrap)

    if (direct) {
      if (newProduct) {
        const { data: created } = await db.from('products').insert({
          company_id: input.companyId,
          name: newProduct.name,
          summary: newProduct.summary,
          created_by: input.sourceUser ?? null,
          updated_by: input.sourceUser ?? null,
        }).select('id').single()
        productId = created?.id ?? null
        if (productId) productByName.set(newProduct.name.toLowerCase(), productId)
      }
      if (relation === 'update' && ref) {
        await db.from('entries').update({ ...fields, ...stamp, status: 'current' }).eq('id', ref.id)
        touched.push(ref.id)
      } else {
        const { data: created } = await db.from('entries').insert({
          company_id: input.companyId,
          product_id: productId,
          ...fields,
          ...stamp,
          created_by: input.sourceUser ?? null,
        }).select('id').single()
        if (created) touched.push(created.id)
      }
      result.applied++
      result.titles.push(fields.title)
      continue
    }

    const kind = relation === 'conflict' ? 'conflict' : relation === 'update' ? 'update' : newProduct ? 'new_product' : 'new'
    const { error } = await db.from('proposals').insert({
      company_id: input.companyId,
      kind,
      source: input.source,
      source_label: input.label ?? null,
      source_user: input.sourceUser ?? null,
      product_id: productId,
      entry_id: ref && kind !== 'new' && kind !== 'new_product' ? ref.id : null,
      payload: { ...fields, new_product: newProduct },
      summary: `${productName ? productName + ' — ' : ''}${fields.title}`,
      evidence,
      confidence,
      dedupe_key: await sha256(`${fields.title.toLowerCase()}|${ref?.id ?? ''}|${fields.effective_from ?? ''}`),
    })
    // 23505 = taka sama propozycja już czeka w kolejce
    if (!error) {
      result.proposed++
      result.titles.push(fields.title)
    } else result.skipped++
  }

  if (touched.length) await embedEntries(touched).catch((e) => console.error('embed', e))
  return result
}

/** Zatwierdzenie propozycji przez człowieka. `choice: 'keep'` przy konflikcie = zostaje stara wersja. */
export async function applyProposal(id: string, actor: string, edits?: Record<string, unknown>) {
  const { data: p } = await db.from('proposals').select('*').eq('id', id).single()
  if (!p || p.status !== 'pending') return null
  const payload = { ...p.payload, ...(edits ?? {}) }
  let productId: string | null = p.product_id
  if (!productId && payload.new_product?.name) {
    const { data: found } = await db.from('products').select('id').eq('company_id', p.company_id)
      .ilike('name', payload.new_product.name).maybeSingle()
    productId = found?.id ?? null
    if (!productId) {
      const { data: created } = await db.from('products').insert({
        company_id: p.company_id,
        name: payload.new_product.name,
        summary: payload.new_product.summary ?? '',
        created_by: actor,
        updated_by: actor,
      }).select('id').single()
      productId = created?.id ?? null
    }
  }
  const fields = {
    type: TYPES.includes(payload.type) ? payload.type : 'fact',
    title: String(payload.title ?? '').slice(0, 160),
    body: String(payload.body ?? '').slice(0, 2000),
    effective_from: isDate(payload.effective_from) ? payload.effective_from : null,
    effective_to: isDate(payload.effective_to) ? payload.effective_to : null,
    importance: Math.min(3, Math.max(0, Number(payload.importance) || 1)),
    source: p.source,
    source_label: p.source_label,
    confidence: p.confidence,
    updated_by: actor,
    verified_at: new Date().toISOString(),
  }
  let entryId: string | null = p.entry_id
  if (entryId) {
    await db.from('entries').update({ ...fields, status: 'current' }).eq('id', entryId)
  } else {
    const { data: created } = await db.from('entries').insert({
      company_id: p.company_id,
      product_id: productId,
      ...fields,
      created_by: actor,
    }).select('id').single()
    entryId = created?.id ?? null
  }
  await db.from('proposals').update({
    status: 'applied',
    resolved_by: actor,
    resolved_at: new Date().toISOString(),
    entry_id: entryId,
    product_id: productId,
  }).eq('id', id)
  if (entryId) await embedEntries([entryId]).catch((e) => console.error('embed', e))
  return entryId
}
