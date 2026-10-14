import { useMemo } from 'react'
import { useSigned } from '../lib/useSigned'
import type { Brand, BrandCluster } from '../lib/types'
import { usePanel } from './Shell'
import { useCompany } from './session'

export interface Cluster {
  /** null = marki bez kategorii */
  id: string | null
  name: string
  brands: Brand[]
}

/** Marki bieżącej firmy: lista, klastry i podpis „Marka › Produkt”. `null` jako marka = cała grupa. */
export function useBrands() {
  const { brands: all, clusters: rows } = usePanel()
  const company = useCompany()
  return useMemo(() => {
    const brands = all.filter((b) => b.status === 'active')
    const byId = new Map(all.map((b) => [b.id, b]))
    const known = new Set(rows.map((c) => c.id))
    // wszystkie kategorie w kolejności firmy (także puste) + marki bez kategorii na końcu
    const allClusters: Cluster[] = [
      ...rows.map((c) => ({ id: c.id, name: c.name, brands: brands.filter((b) => b.cluster_id === c.id) })),
      { id: null, name: 'Bez kategorii', brands: brands.filter((b) => !b.cluster_id || !known.has(b.cluster_id)) },
    ]
    const clusters = allClusters.filter((c) => c.brands.length)
    const name = (id?: string | null) => (id ? byId.get(id)?.name ?? 'Marka usunięta' : company.name)
    const label = (id?: string | null, product?: string | null) => [name(id), product].filter(Boolean).join(' › ')
    return { brands, all, byId, clusters, allClusters, rows: rows as BrandCluster[], name, label, group: company.name }
  }, [all, rows, company.name])
}

const initials = (name: string) =>
  name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).join('').slice(0, 3).toUpperCase()

/** Znak marki: logo albo inicjały. Bez marki — znak całej grupy. */
export function BrandMark({ brand, size = 28, group }: { brand?: Brand | null; size?: number; group?: string }) {
  const url = useSigned([brand?.logo_path])[brand?.logo_path ?? '']
  const text = initials(brand?.name ?? group ?? 'G')
  if (url) return <span className="bmark bmark--logo" style={{ width: size, height: size }}><img src={url} alt="" /></span>
  return (
    <span className={`bmark${brand ? '' : ' bmark--group'}`} style={{ width: size, height: size, fontSize: Math.max(9, size * (text.length > 2 ? 0.3 : 0.38)) }}>
      {text}
    </span>
  )
}
