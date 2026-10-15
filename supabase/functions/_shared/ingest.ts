// Wspólny potok: dowolny tekst (mail, kalendarz, strona, plik, Claude) → fakty w bazie wiedzy.
// Surowy tekst źródła nigdzie nie jest zapisywany — do bazy trafia tylko to, co model uznał za wiedzę firmową.
// Każdy fakt dostaje własną markę: tekst o kilku markach rozkłada się na kilka marek, nie trafia hurtem do jednej.

import { chatJSON, embed, toVector } from './ai.ts'
import { brandLabel, bare, type Catalog, catalogText, ensureBrand, findProduct, loadCatalog, resolveBrand } from './brands.ts'
import { db, sha256, today } from './core.ts'

export type Source = 'email' | 'calendar' | 'claude' | 'website' | 'file' | 'chat' | 'manual'
export type Visibility = 'public' | 'internal' | 'confidential'

export interface IngestInput {
  companyId: string
  source: Source
  text: string
  label?: string
  sourceUser?: string | null
  /** strona firmowa, plik lub ręczny import: produkty zakładamy od razu, bez kolejki */
  bootstrap?: boolean
  /** użytkownik sam potwierdził (Claude): pomijamy próg pewności i nie odrzucamy niczego po cichu */
  trusted?: boolean
  /** nic nie stosujemy automatycznie — wszystko idzie do «Do sprawdzenia» */
  reviewOnly?: boolean
  productHint?: string | null
  /** marka wskazana przez nadawcę (id lub nazwa) — tylko podpowiedź, każdy fakt jest sprawdzany osobno */
  brandHint?: string | null
  visibilityHint?: Visibility | null
  /** wspólny identyfikator paczki propozycji (jeden import = jedna paczka) */
  batchId?: string
}

export type Outcome = 'applied' | 'proposed' | 'duplicate' | 'personal' | 'past' | 'empty'

export interface ItemResult {
  title: string
  outcome: Outcome
  /** „Marka › Produkt” albo nazwa grupy */
  where: string
  /** dlaczego tak: inna marka niż wskazana, konflikt, nowy produkt… */
  note?: string
  /** wpis, z którym fakt się pokrywa lub jest sprzeczny */
  existing?: { id: string; title: string; where: string }
  proposal_id?: string
  entry_id?: string
}

export interface IngestResult {
  applied: number
  proposed: number
  skipped: number
  titles: string[]
  items: ItemResult[]
  batch_id: string
}

interface Item {
  brand: string | null
  product: string | null
  product_summary?: string
  type: string
  title: string
  body: string
  effective_from: string | null
  effective_to: string | null
  importance: number
  confirmed: boolean
  personal?: boolean
  private?: boolean
  visibility?: string
  confidence: number
  relation: 'new' | 'update' | 'conflict' | 'duplicate'
  existing: string | null
  /** tekst wprost mówi, że ten termin przeniesiono albo odwołano */
  change?: 'rescheduled' | 'cancelled' | null
  evidence: string
}

const TYPES = ['fact', 'price', 'date', 'news', 'announcement', 'faq', 'link']
const VIS: Visibility[] = ['public', 'internal', 'confidential']
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

const SYSTEM = `You maintain AURORA — the knowledge base of a HOLDING (group of companies) that owns several BRANDS. Each brand has its own PRODUCTS (services, events, programs). Knowledge covers products, prices, dates, brand rules, strategy, organisation and official announcements.
You receive a piece of text from a source (email, calendar, website, document, assistant) and must extract knowledge that belongs in the company knowledge base.

BRANDS — the most important rule. Assign EVERY item separately to exactly one place:
- "brand": the exact brand name from BRANDS that the item is about. Use "GROUP" when the item is about the whole holding, about several brands at once, or compares brands (e.g. "brand A and brand B are separate", cluster structure, group-wide writing rules, experience of the whole group).
- One text often mixes brands: split it and give each item its own brand. A hint from the sender ("THE SENDER SUGGESTS BRAND") is only a hint — if an item is clearly about another brand, assign that other brand.
- A brand name that is not on the list but clearly is a separate brand of the group: put that name in "brand".
- "product": exact name from the PRODUCTS of THAT brand when the item is about one of them; a short new product name only when the text clearly describes a sellable product/service/event of that brand that is not listed (add "product_summary", one sentence); null for knowledge about the brand itself. NEVER use a brand name as a product name.

PRIVACY — "personal": true (the item will be dropped) ONLY for:
- private life, health, family, salaries, HR evaluations and conflicts about named people
- personal data of clients or private persons (private phone/e-mail/address, individual orders or complaints), invoices, bank data, passwords, access codes
NOT personal (keep them, "personal": false): company roles and job titles (who is Growth Director, CEO, instructor), company contact data (company phone numbers, company e-mails, office addresses), strategy, plans and decisions (soft launch in Q4), competitive advantages, internal concepts and frameworks, brand claims, organisation of the group.
Never copy greetings or signatures. Never quote the source — restate neutrally.

"visibility": "public" — may be told to clients (offer, prices, dates, published info); "internal" — team knowledge (processes, organisation, roles, rules); "confidential" — strategy and plans not announced yet, competitive analysis, margins, internal concepts.

OLD VS NEW: compare every date with TODAY. Do not extract events that already ended. When the text gives an old and a new value, keep only the new one. If EXISTING ENTRIES already hold a newer value than the text, the relation is "duplicate", never "update".

DATES ADD UP, THEY DO NOT REPLACE EACH OTHER. Products are often held many times: events, trainings, trips, courses, workshops, webinars, tastings, races, shows. Every date (edition, term, session) is its own item of type "date" — one item per date, never merge several dates into one item.
- A date of the same product that is not in EXISTING ENTRIES is a further edition: relation "new". A different day, place or hours does NOT make it a "conflict" or an "update" of another date. A schedule or calendar listing many dates = many "new" items.
- The same product on the same day already in EXISTING ENTRIES → "duplicate" (or "update" when the text definitively changes its details, e.g. hours or price of THAT day).
- "update" of an existing date to another day ONLY when the text explicitly says THAT edition was moved/postponed/rescheduled (e.g. "przeniesione z 30.10 na 6.11", "nowy termin zamiast…") → set "change": "rescheduled". When the text explicitly says an edition was cancelled → "update" with "change": "cancelled" and say so in title and body. Otherwise "change": null.
- When unsure whether a date replaces another one, treat it as a further edition ("new"), not as a conflict.

"confirmed": true only when the text states a decision/fact definitively (e.g. "we confirm", "from 1 Nov the price is", published on the company website). Proposals, "maybe", questions → false.
"importance": 0 trivial, 1 normal, 2 important for the whole team, 3 critical/urgent announcement.
"type": one of fact | price | date | news | announcement | faq | link. "announcement" = message to the whole team, "news" = something that happened.
"relation" compares with EXISTING ENTRIES (each shows its brand and product):
- "duplicate": the base already says the same → give "existing" id
- "update": the same subject, the new text definitively replaces the old value → give "existing" id
- "conflict": the same subject but a different value and it is NOT clear which one is right → give "existing" id. Two different dates of a product are two subjects, not a conflict.
- "new": nothing similar exists, or it is another edition/date of an existing product. An entry of ANOTHER brand is never the same subject.
"title": short (max 80 chars), specific, names the brand or product when useful. "body": 1–4 full sentences with all concrete values (numbers, currency, dates). Write title, body and evidence in Polish (keep names unchanged).
"evidence": one neutral sentence explaining where this comes from, WITHOUT names of private people and without quoting.
Dates as YYYY-MM-DD. If the year is missing, choose the nearest future date relative to TODAY. "effective_from" ONLY for a concrete date in the text — never TODAY by default. Use type "date" only for events and deadlines on a specific day.

Return ONLY JSON: {"items":[{"brand":string,"product":string|null,"product_summary":string,"type":string,"title":string,"body":string,"effective_from":string|null,"effective_to":string|null,"importance":1,"confirmed":true,"personal":false,"visibility":"internal","confidence":0.0,"relation":"new","existing":string|null,"change":null,"evidence":string}]}
If there is nothing worth storing return {"items":[]}. Most private emails contain nothing — that is the expected answer.`

export async function embedEntries(ids: string[]) {
  if (!ids.length) return
  const { data } = await db.from('entries').select('id, title, body, product:products(name), brand:brands(name)').in('id', ids)
  if (!data?.length) return
  // deno-lint-ignore no-explicit-any
  const texts = data.map((e: any) => `${e.brand?.name ? e.brand.name + '. ' : ''}${e.product?.name ? e.product.name + '. ' : ''}${e.title}. ${e.body}`)
  const vectors = await embed(texts, 'document')
  await Promise.all(data.map((e, i) => db.from('entries').update({ embedding: toVector(vectors[i]) }).eq('id', e.id)))
}

/** Marka wskazana przez nadawcę: id, nazwa albo alias. */
function hintBrand(cat: Catalog, hint?: string | null) {
  if (!hint) return undefined
  const byId = cat.brandById.get(hint)
  if (byId) return byId
  const r = resolveBrand(cat, hint)
  return r && 'unknown' in r ? undefined : r
}

export async function ingestText(input: IngestInput): Promise<IngestResult> {
  const batchId = input.batchId ?? crypto.randomUUID()
  const result: IngestResult = { applied: 0, proposed: 0, skipped: 0, titles: [], items: [], batch_id: batchId }
  const text = input.text.replace(/\s+\n/g, '\n').trim().slice(0, 9000)
  if (text.length < 40) return result

  const cat = await loadCatalog(input.companyId)
  if (!cat) return result
  const autoApply = !input.reviewOnly && cat.company.settings?.auto_apply !== false
  const hinted = hintBrand(cat, input.brandHint)

  const [queryVec] = await embed([text.slice(0, 2000)], 'query')
  const { data: similar } = await db.rpc('match_entries', {
    p_company: input.companyId,
    p_embedding: toVector(queryVec),
    p_query: text.slice(0, 200),
    p_limit: 12,
    p_brand: hinted?.id ?? null,
    p_confidential: true,
  })
  // deno-lint-ignore no-explicit-any
  const existing = ((similar ?? []) as any[]).filter((e) => e.score > 0.35)
  const refs = new Map(existing.map((e, i) => [`E${i + 1}`, e]))
  // deno-lint-ignore no-explicit-any
  const whereOf = (e: any) => brandLabel(cat, e.brand_id, e.product_name)

  const user = [
    `TODAY: ${today()}`,
    `HOLDING: ${cat.company.name}`,
    `SOURCE: ${input.source}`,
    hinted ? `THE SENDER SUGGESTS BRAND: ${hinted.name}` : input.brandHint ? `THE SENDER SUGGESTS BRAND: ${input.brandHint}` : '',
    input.productHint ? `THE SENDER SUGGESTS PRODUCT: ${input.productHint}` : '',
    `BRANDS AND THEIR PRODUCTS:\n${catalogText(cat)}`,
    `EXISTING ENTRIES (brand › product, type, date, source, last update):\n${[...refs].map(([ref, e]) => `${ref} [${whereOf(e)}] (${e.type}${e.effective_from ? `, ${e.effective_from}${e.effective_to && e.effective_to !== e.effective_from ? '…' + e.effective_to : ''}` : ''}, ${e.source}, ${String(e.updated_at).slice(0, 10)}) ${e.title}: ${String(e.body).slice(0, 300)}`).join('\n') || '(none)'}`,
    `TEXT:\n"""\n${text}\n"""`,
  ].filter(Boolean).join('\n\n')

  const parsed = await chatJSON<{ items: Item[] }>(SYSTEM, user, 2600)
  const items = Array.isArray(parsed?.items) ? parsed!.items.slice(0, 14) : []
  const touched: string[] = []
  const push = (r: ItemResult) => {
    result.items.push(r)
    if (r.outcome === 'applied') result.applied++
    else if (r.outcome === 'proposed') result.proposed++
    else result.skipped++
    if (r.outcome === 'applied' || r.outcome === 'proposed') result.titles.push(r.title)
  }

  for (const it of items) {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) continue
    const title = it.title.trim().slice(0, 160)

    // ── marka i produkt ──
    const resolved = resolveBrand(cat, it.brand)
    let brandId: string | null = resolved === undefined ? hinted?.id ?? null : resolved && !('unknown' in resolved) ? resolved.id : null
    const newBrand = resolved && 'unknown' in resolved ? resolved.unknown : null
    const notes: string[] = []

    let ref = it.existing ? refs.get(String(it.existing).trim()) : null
    // wpis innej marki nigdy nie jest „tym samym” — model bywa tu zbyt hojny
    if (ref && (ref.brand_id ?? null) !== brandId && !newBrand) ref = null
    let relation = ref ? it.relation : 'new'

    const personal = it.personal === true || it.private === true
    if (personal && !input.trusted) {
      push({ title, outcome: 'personal', where: brandLabel(cat, brandId), note: 'AI uznało to za dane osobowe lub prywatne — nie zapisano.' })
      continue
    }

    if (relation === 'duplicate' && ref) {
      // to samo potwierdzone z nowego źródła = wpis nadal aktualny
      await db.from('entries').update({ verified_at: new Date().toISOString() }).eq('id', ref.id)
      push({ title, outcome: 'duplicate', where: whereOf(ref), existing: { id: ref.id, title: ref.title, where: whereOf(ref) } })
      continue
    }

    let productId: string | null = ref?.product_id ?? null
    let productName: string | null = ref?.product_name ?? null
    let newProduct: { name: string; summary: string } | null = null
    const wantedProduct = it.product?.trim() || (input.productHint && (!hinted || brandId === hinted.id) ? input.productHint : null)
    if (!productId && wantedProduct && !newBrand) {
      // nazwa marki podana jako produkt = wiedza o samej marce
      const asBrand = resolveBrand(cat, wantedProduct)
      if (asBrand && !('unknown' in asBrand)) {
        if (!brandId) brandId = asBrand.id
      } else {
        const found = findProduct(cat, wantedProduct, brandId)
        if (found) {
          if (found.brand_id && brandId && found.brand_id !== brandId) notes.push(`produkt „${found.name}” należy do marki ${cat.brandById.get(found.brand_id)?.name}`)
          productId = found.id
          productName = found.name
          if (found.brand_id) brandId = found.brand_id
        } else newProduct = { name: wantedProduct.slice(0, 80), summary: String(it.product_summary ?? '').slice(0, 300) }
      }
    }
    if (hinted && brandId !== hinted.id && !newBrand) notes.push(`przypisano do ${brandId ? cat.brandById.get(brandId)?.name : 'całej grupy'}, choć wskazano ${hinted.name}`)
    if (newBrand) notes.push(`nowa marka „${newBrand}” — do potwierdzenia`)
    if (personal) notes.push('AI oznaczyło to jako dane osobowe — zdecyduj, czy zapisać')

    const fields = {
      type: TYPES.includes(it.type) ? it.type : 'fact',
      title,
      body: String(it.body ?? '').trim().slice(0, 2000),
      effective_from: isDate(it.effective_from) ? it.effective_from : null,
      effective_to: isDate(it.effective_to) ? it.effective_to : null,
      importance: Math.min(3, Math.max(0, Math.round(Number(it.importance) || 1))),
    }
    const visibility: Visibility = personal ? 'confidential'
      : input.visibilityHint ?? (VIS.includes(it.visibility as Visibility) ? it.visibility as Visibility : input.source === 'website' ? 'public' : 'internal')
    const confidence = Math.min(1, Math.max(0, Number(it.confidence) || 0.5))
    const evidence = String(it.evidence ?? '').slice(0, 300)
    const where = brandLabel(cat, brandId, productName ?? newProduct?.name)

    // terminy się sumują: inny dzień tego samego produktu to kolejna edycja, a nie zmiana ani konflikt.
    // Starszy termin zastępujemy tylko wtedy, gdy tekst wprost mówi, że go przeniesiono albo odwołano.
    const moved = it.change === 'rescheduled' || it.change === 'cancelled'
    if (ref && (relation === 'update' || relation === 'conflict') && fields.type === 'date' && ref.type === 'date'
      && fields.effective_from && ref.effective_from && fields.effective_from !== ref.effective_from && !moved) {
      relation = 'new'
      ref = null
    }
    if (ref && moved && (relation === 'update' || relation === 'conflict')) notes.push(it.change === 'cancelled' ? 'termin odwołany' : 'termin przeniesiony')

    // zapora przed dublami: model bywa pewny, że fakt jest „nowy”, choć baza już go zna innymi słowami
    if (relation === 'new') {
      let twin = db.from('entries').select('id, title, brand_id, product:products(name)').eq('company_id', input.companyId).neq('status', 'archived')
        .ilike('title', fields.title.replace(/[%_\\]/g, ' '))
      twin = fields.effective_from ? twin.eq('effective_from', fields.effective_from) : twin.is('effective_from', null)
      twin = brandId ? twin.eq('brand_id', brandId) : twin.is('brand_id', null)
      const { data: same } = await twin.limit(1)
      // deno-lint-ignore no-explicit-any
      let duplicateOf: any = same?.[0] ? { id: same[0].id, title: same[0].title, brand_id: same[0].brand_id, product_name: (same[0] as any).product?.name } : null
      if (!duplicateOf) {
        const [vec] = await embed([`${brandId ? cat.brandById.get(brandId)?.name + '. ' : ''}${productName ?? newProduct?.name ?? ''}. ${fields.title}. ${fields.body}`], 'document')
        const { data: near } = await db.rpc('nearest_entries', { p_company: input.companyId, p_embedding: toVector(vec), p_limit: 3 })
        // deno-lint-ignore no-explicit-any
        for (const hit of (near ?? []) as any[]) {
          if ((hit.brand_id ?? null) !== brandId) continue
          const sameDates = hit.effective_from === fields.effective_from && hit.effective_to === fields.effective_to
          const sameProduct = !productId || !hit.product_id || hit.product_id === productId
          if (hit.cos >= 0.955 && sameDates) duplicateOf = hit
          // ten sam produkt tego samego dnia = ten sam termin; inny dzień to kolejna edycja i zapisujemy ją obok
          else if (fields.type === 'date' && hit.type === 'date' && sameProduct && hit.cos >= 0.88 && sameDates) duplicateOf = hit
          if (duplicateOf) break
        }
      }
      if (duplicateOf) {
        await db.from('entries').update({ verified_at: new Date().toISOString() }).eq('id', duplicateOf.id)
        const dWhere = brandLabel(cat, duplicateOf.brand_id, duplicateOf.product_name ?? cat.products.find((p) => p.id === duplicateOf.product_id)?.name)
        push({ title, outcome: 'duplicate', where: dWhere, existing: { id: duplicateOf.id, title: duplicateOf.title, where: dWhere } })
        continue
      }
    }

    // strona WWW pełna jest starych aktualności: minione wydarzenia pomijamy
    const ended = fields.effective_to ?? fields.effective_from
    if (input.source === 'website' && fields.type === 'date' && ended && ended < today()) {
      push({ title, outcome: 'past', where, note: 'Wydarzenie już się odbyło.' })
      continue
    }
    // to, co wpisał lub poprawił człowiek, zmienia tylko człowiek; strona nie nadpisuje też faktów z poczty
    const guarded = relation === 'update' && ref && (ref.source === 'manual' || (input.source === 'website' && ref.source !== 'website'))
    if (guarded && !input.trusted) relation = 'conflict'

    const sure = input.trusted || (it.confirmed && confidence >= 0.7)
    const direct = autoApply && sure && relation !== 'conflict' && !personal && !newBrand && (!newProduct || input.bootstrap)
    const existingInfo = ref ? { id: ref.id, title: ref.title, where: whereOf(ref) } : undefined

    if (direct) {
      if (newProduct) {
        const { data: created } = await db.from('products').insert({
          company_id: input.companyId,
          brand_id: brandId,
          name: newProduct.name,
          summary: newProduct.summary,
          created_by: input.sourceUser ?? null,
          updated_by: input.sourceUser ?? null,
        }).select('id').single()
        productId = created?.id ?? null
        if (productId) cat.products.push({ id: productId, name: newProduct.name, summary: newProduct.summary, kind: '', brand_id: brandId })
      }
      const stamp = {
        source: input.source,
        source_label: input.label ?? null,
        confidence,
        updated_by: input.sourceUser ?? null,
        verified_at: new Date().toISOString(),
        visibility,
      }
      let entryId: string | null = null
      if (relation === 'update' && ref) {
        await db.from('entries').update({ ...fields, ...stamp, status: 'current' }).eq('id', ref.id)
        entryId = ref.id
      } else {
        const { data: created } = await db.from('entries').insert({
          company_id: input.companyId,
          brand_id: brandId,
          product_id: productId,
          ...fields,
          ...stamp,
          created_by: input.sourceUser ?? null,
        }).select('id').single()
        entryId = created?.id ?? null
      }
      if (entryId) touched.push(entryId)
      push({ title, outcome: 'applied', where, entry_id: entryId ?? undefined, existing: relation === 'update' ? existingInfo : undefined, note: [relation === 'update' ? 'zastąpiono starszą wersję' : '', ...notes].filter(Boolean).join('; ') || undefined })
      continue
    }

    const kind = relation === 'conflict' ? 'conflict' : relation === 'update' ? 'update' : newProduct ? 'new_product' : 'new'
    const why = [
      kind === 'conflict' ? 'sprzeczne z wpisem w bazie' : '',
      kind === 'new_product' ? 'nowy produkt w katalogu' : '',
      !sure ? 'informacja nie jest potwierdzona' : '',
      ...notes,
    ].filter(Boolean)
    const { data: prop, error } = await db.from('proposals').insert({
      company_id: input.companyId,
      kind,
      source: input.source,
      source_label: input.label ?? null,
      source_user: input.sourceUser ?? null,
      brand_id: brandId,
      product_id: productId,
      entry_id: ref && kind !== 'new' && kind !== 'new_product' ? ref.id : null,
      payload: { ...fields, visibility, new_product: newProduct, new_brand: newBrand ? { name: newBrand } : null, flag: personal ? 'personal' : null },
      summary: `${where} — ${fields.title}`,
      evidence: [why.length ? `${why.join('; ')}.` : '', evidence].filter(Boolean).join(' ').slice(0, 500),
      confidence,
      batch_id: batchId,
      dedupe_key: await sha256(`${fields.title.toLowerCase()}|${ref?.id ?? ''}|${fields.effective_from ?? ''}|${brandId ?? ''}`),
    }).select('id').single()
    if (!error && prop) push({ title, outcome: 'proposed', where, proposal_id: prop.id, existing: existingInfo, note: why.join('; ') || undefined })
    // 23505 = taka sama propozycja już czeka w kolejce
    else push({ title, outcome: 'duplicate', where, note: 'Taka sama propozycja już czeka w „Do sprawdzenia”.' })
  }

  if (!items.length) result.items.push({ title: '', outcome: 'empty', where: '', note: 'Model nie znalazł w tekście wiedzy do zapisania.' })
  if (touched.length) await embedEntries(touched).catch((e) => console.error('embed', e))
  return result
}

export interface ApplyEdits {
  title?: string
  body?: string
  effective_from?: string | null
  /** `null` = cała grupa */
  brand_id?: string | null
  /** `null` = wiedza o marce, bez produktu */
  product_id?: string | null
  visibility?: Visibility
}

/** Zatwierdzenie propozycji przez człowieka, z możliwością poprawienia treści, marki i produktu. */
export async function applyProposal(id: string, actor: string, edits: ApplyEdits = {}) {
  const { data: p } = await db.from('proposals').select('*').eq('id', id).single()
  if (!p || p.status !== 'pending') return null
  const payload = { ...p.payload, ...pick(edits, ['title', 'body', 'effective_from', 'visibility']) }

  let brandId: string | null = 'brand_id' in edits ? edits.brand_id ?? null : p.brand_id
  if (!('brand_id' in edits) && !brandId && payload.new_brand?.name) brandId = await ensureBrand(p.company_id, payload.new_brand.name)
  if (brandId) {
    const { data: ok } = await db.from('brands').select('id').eq('id', brandId).eq('company_id', p.company_id).maybeSingle()
    if (!ok) brandId = null
  }

  let productId: string | null = 'product_id' in edits ? edits.product_id ?? null : p.product_id
  if (productId) {
    const { data: prod } = await db.from('products').select('id, brand_id').eq('id', productId).eq('company_id', p.company_id).maybeSingle()
    productId = prod?.id ?? null
    // przy zmianie marki produkt z innej marki odpada
    if (prod && 'brand_id' in edits && prod.brand_id !== brandId && !('product_id' in edits)) productId = null
  }
  if (!productId && !('product_id' in edits) && payload.new_product?.name) {
    const { data: same } = await db.from('products').select('id, name, brand_id').eq('company_id', p.company_id).neq('status', 'archived')
    const wanted = bare(payload.new_product.name)
    productId = (same ?? []).find((x) => bare(x.name) === wanted && (x.brand_id ?? null) === brandId)?.id ?? null
    if (!productId) {
      const { data: created } = await db.from('products').insert({
        company_id: p.company_id,
        brand_id: brandId,
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
    visibility: VIS.includes(payload.visibility) ? payload.visibility : 'internal',
    source: p.source,
    source_label: p.source_label,
    confidence: p.confidence,
    updated_by: actor,
    verified_at: new Date().toISOString(),
  }
  let entryId: string | null = p.entry_id
  if (entryId) {
    const place = 'brand_id' in edits || 'product_id' in edits ? { brand_id: brandId, product_id: productId } : {}
    await db.from('entries').update({ ...fields, ...place, status: 'current' }).eq('id', entryId)
  } else {
    const { data: created } = await db.from('entries').insert({
      company_id: p.company_id,
      brand_id: brandId,
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
    brand_id: brandId,
  }).eq('id', id)
  if (entryId) await embedEntries([entryId]).catch((e) => console.error('embed', e))
  return entryId
}

function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) if (k in o && o[k] !== undefined) out[k] = o[k]
  return out
}
