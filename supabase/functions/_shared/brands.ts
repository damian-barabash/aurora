// Katalog firmy: holding → marki → produkty. Wspólne dla potoku faktów, czatu i MCP.

import { db } from './core.ts'

export interface BrandRow {
  id: string
  name: string
  cluster: string
  aliases: string[]
  summary: string
  website: string | null
}

export interface ProductRow {
  id: string
  name: string
  summary: string
  kind: string
  brand_id: string | null
}

export interface Catalog {
  company: { id: string; name: string; settings: Record<string, unknown> | null }
  brands: BrandRow[]
  products: ProductRow[]
  brandById: Map<string, BrandRow>
}

/** Nazwa bez roku, cyfr i znaków — do rozpoznania tej samej nazwy w innej pisowni. */
export const bare = (name: string) =>
  name.toLowerCase().replace(/\b20\d\d\b|[^\p{L} ]/gu, ' ').replace(/\s+/g, ' ').trim()

export async function loadCatalog(companyId: string): Promise<Catalog | null> {
  const [{ data: company }, { data: brands }, { data: products }, { data: clusters }] = await Promise.all([
    db.from('companies').select('id, name, settings').eq('id', companyId).single(),
    db.from('brands').select('id, name, cluster, cluster_id, aliases, summary, website, position').eq('company_id', companyId).eq('status', 'active').order('position'),
    db.from('products').select('id, name, summary, kind, brand_id').eq('company_id', companyId).neq('status', 'archived').order('name'),
    db.from('brand_clusters').select('id, position').eq('company_id', companyId),
  ])
  if (!company) return null
  // kolejność jak w panelu: kategoria, potem marka; marki bez kategorii na końcu
  const rank = new Map((clusters ?? []).map((c) => [c.id, c.position as number]))
  const list = ((brands ?? []) as (BrandRow & { cluster_id: string | null; position: number })[])
    .sort((a, b) => (rank.get(a.cluster_id ?? '') ?? 1e9) - (rank.get(b.cluster_id ?? '') ?? 1e9) || a.position - b.position)
  return { company, brands: list, products: (products ?? []) as ProductRow[], brandById: new Map(list.map((b) => [b.id, b])) }
}

const GROUP_WORDS = new Set(['group', 'grupa', 'holding', 'company', 'firma', 'all', 'wszystkie'])

/**
 * Marka po nazwie lub aliasie. `undefined` = model nie wskazał marki, `null` = cała grupa,
 * `{ unknown }` = nazwa, której nie ma w katalogu.
 */
export function resolveBrand(cat: Catalog, raw: unknown): BrandRow | null | undefined | { unknown: string } {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) return undefined
  if (GROUP_WORDS.has(name.toLowerCase()) || bare(name) === bare(cat.company.name)) return null
  const wanted = bare(name)
  for (const b of cat.brands) {
    if (b.id === name || bare(b.name) === wanted || b.aliases.some((a) => bare(a) === wanted)) return b
  }
  // „Fastline Racing Academy Sp. z o.o.” i podobne
  for (const b of cat.brands) {
    const have = bare(b.name)
    if (have.length >= 6 && (wanted.startsWith(have) || have.startsWith(wanted))) return b
  }
  return { unknown: name.slice(0, 80) }
}

/** Produkt po nazwie: najpierw w obrębie marki, potem w całej firmie. */
export function findProduct(cat: Catalog, raw: string, brandId?: string | null): ProductRow | null {
  const wanted = bare(raw)
  if (wanted.length < 3) return null
  const scope = brandId === undefined ? cat.products : [
    ...cat.products.filter((p) => p.brand_id === brandId),
    ...cat.products.filter((p) => p.brand_id !== brandId),
  ]
  const exact = scope.find((p) => p.name.trim().toLowerCase() === raw.trim().toLowerCase()) ?? scope.find((p) => bare(p.name) === wanted)
  if (exact) return exact
  // „Ice Driving Experience 2027” to ten sam produkt co „Ice Driving Experience”
  return scope.find((p) => {
    const have = bare(p.name)
    return have.length >= 4 && wanted.length >= 4 && (have.startsWith(wanted) || wanted.startsWith(have))
  }) ?? null
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Marki wymienione w tekście (nazwa, alias, nazwa produktu). Krótkie skróty (FRA, FIQ) tylko wielkimi literami. */
export function brandsInText(cat: Catalog, text: string): string[] {
  const found = new Set<string>()
  const lower = text.toLowerCase()
  for (const b of cat.brands) {
    const names = [b.name, ...b.aliases]
    for (const n of names) {
      if (n.length <= 4) {
        if (new RegExp(`(^|[^\\p{L}])${escape(n)}([^\\p{L}]|$)`, 'u').test(text)) found.add(b.id)
      } else if (new RegExp(`(^|[^\\p{L}])${escape(n.toLowerCase())}`, 'u').test(lower)) found.add(b.id)
    }
  }
  for (const p of productsInText(cat, text)) if (p.brand_id) found.add(p.brand_id)
  return [...found]
}

/** Produkty wymienione w tekście. */
export function productsInText(cat: Catalog, text: string): ProductRow[] {
  const t = bare(text)
  return cat.products.filter((p) => {
    const n = bare(p.name)
    return n.length >= 5 && t.includes(n)
  })
}

/** Drzewo marek do podpowiedzi dla modelu. */
export function catalogText(cat: Catalog, opts: { summaries?: boolean; products?: boolean } = {}): string {
  const { summaries = true, products = true } = opts
  const lines: string[] = []
  const clusters = [...new Set(cat.brands.map((b) => b.cluster || 'Bez kategorii'))]
  for (const cluster of clusters) {
    lines.push(`${cluster}:`)
    for (const b of cat.brands.filter((x) => (x.cluster || 'Bez kategorii') === cluster)) {
      const aka = b.aliases.length ? ` (aka ${b.aliases.join(', ')})` : ''
      lines.push(`- ${b.name}${aka}${summaries && b.summary ? ` — ${b.summary.slice(0, 160)}` : ''}`)
      if (products) {
        for (const p of cat.products.filter((x) => x.brand_id === b.id)) {
          lines.push(`    • ${p.name}${p.kind ? ` (${p.kind})` : ''}${summaries && p.summary ? ` — ${p.summary.slice(0, 120)}` : ''}`)
        }
      }
    }
  }
  const loose = cat.products.filter((p) => !p.brand_id)
  if (products && loose.length) {
    lines.push('Group-level products (no brand):')
    for (const p of loose) lines.push(`    • ${p.name}`)
  }
  return lines.join('\n') || '(no brands yet)'
}

export const brandLabel = (cat: Catalog, brandId: string | null | undefined, productName?: string | null) => {
  const b = brandId ? cat.brandById.get(brandId)?.name : null
  return [b ?? cat.company.name, productName].filter(Boolean).join(' › ')
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'marka'

/** Nowa marka z propozycji: najpierw szukamy istniejącej o tej nazwie. */
export async function ensureBrand(companyId: string, name: string): Promise<string | null> {
  const clean = name.trim().slice(0, 80)
  if (clean.length < 2) return null
  const { data: all } = await db.from('brands').select('id, name, aliases, slug').eq('company_id', companyId)
  const hit = (all ?? []).find((b) => bare(b.name) === bare(clean) || (b.aliases as string[]).some((a) => bare(a) === bare(clean)))
  if (hit) return hit.id
  let slug = slugify(clean)
  if ((all ?? []).some((b) => b.slug === slug)) slug = `${slug}-${(all ?? []).length + 1}`
  const { data } = await db.from('brands').insert({ company_id: companyId, name: clean, slug, position: ((all ?? []).length + 1) * 10 }).select('id').single()
  if (data) await db.from('brand').insert({ company_id: companyId, brand_id: data.id })
  return data?.id ?? null
}

/** Kategoria po nazwie (bez względu na wielkość liter); `create` zakłada brakującą na końcu listy. */
export async function findCluster(companyId: string, name: string, create = false): Promise<string | null> {
  const clean = name.trim().slice(0, 60)
  if (!clean) return null
  const { data: all } = await db.from('brand_clusters').select('id, name, position').eq('company_id', companyId)
  const hit = (all ?? []).find((c) => c.name.toLowerCase() === clean.toLowerCase())
  if (hit || !create) return hit?.id ?? null
  const position = Math.max(0, ...(all ?? []).map((c) => c.position as number)) + 10
  const { data } = await db.from('brand_clusters').insert({ company_id: companyId, name: clean, position }).select('id').single()
  return data?.id ?? null
}
