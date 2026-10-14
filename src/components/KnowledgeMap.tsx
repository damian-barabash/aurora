import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { ArrowUpRight, Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBrands } from '../app/brands'
import { useCompany, useQuery } from '../app/session'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { cx, IconBtn, Loading, Toggle } from './ui'

type Kind = 'group' | 'cluster' | 'brand' | 'product'

interface MapNode extends SimulationNodeDatum {
  id: string
  kind: Kind
  label: string
  /** liczba faktów przypisanych wprost do węzła */
  facts: number
  r: number
  href?: string
  logo?: string | null
}

interface MapLink extends SimulationLinkDatum<MapNode> {
  id: string
  kind: 'tree' | 'mention'
  weight: number
  /** przykładowe tytuły faktów, z których wynika powiązanie */
  samples: string[]
}

interface Fact { id: string; brand_id: string | null; product_id: string | null; title: string; body: string }

const bare = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b20\d\d\b|[^\p{L} ]/gu, ' ').replace(/\s+/g, ' ').trim()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const radius = (kind: Kind, facts: number) =>
  kind === 'group' ? 34 : kind === 'cluster' ? 10 : kind === 'brand' ? 16 + Math.min(18, Math.sqrt(facts) * 3) : 7 + Math.min(12, Math.sqrt(facts) * 2.4)
const initials = (name: string) => name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).join('').slice(0, 3).toUpperCase()

/**
 * Mapa wiedzy: grupa → kategorie → marki → produkty, a do tego powiązania wynikające z faktów
 * (fakt jednej marki lub produktu wspomina inną markę lub produkt).
 */
export default function KnowledgeMap({ products, focus }: { products: Product[]; focus?: string | null }) {
  const company = useCompany()
  const { brands, rows, byId, group } = useBrands()
  const [showProducts, setShowProducts] = useState(true)
  const [showMentions, setShowMentions] = useState(true)
  const [selected, setSelected] = useState<string | null>(focus ? `b:${focus}` : null)
  const [hover, setHover] = useState<string | null>(null)

  const { data: facts, loading } = useQuery(async () => {
    const { data } = await supabase.from('entries').select('id, brand_id, product_id, title, body')
      .eq('company_id', company.id).neq('status', 'archived').order('updated_at', { ascending: false }).limit(2000)
    return (data ?? []) as Fact[]
  }, [company.id])

  // ── graf ──
  const graph = useMemo(() => {
    const nodes: MapNode[] = []
    const links: MapLink[] = []
    const factsOf = new Map<string, Fact[]>()
    const ownerOf = (f: Fact) => (f.product_id && products.some((p) => p.id === f.product_id) ? `p:${f.product_id}` : f.brand_id && byId.get(f.brand_id)?.status === 'active' ? `b:${f.brand_id}` : 'group')
    for (const f of facts ?? []) {
      const key = ownerOf(f)
      if (!factsOf.has(key)) factsOf.set(key, [])
      factsOf.get(key)!.push(f)
    }
    const add = (n: Omit<MapNode, 'r' | 'facts'>) => {
      const count = factsOf.get(n.id)?.length ?? 0
      nodes.push({ ...n, facts: count, r: radius(n.kind, count) })
    }
    add({ id: 'group', kind: 'group', label: group, href: '/app/kb?b=group' })
    const usedClusters = rows.filter((c) => brands.some((b) => b.cluster_id === c.id))
    for (const c of usedClusters) {
      add({ id: `c:${c.id}`, kind: 'cluster', label: c.name })
      links.push({ id: `t:group-${c.id}`, source: 'group', target: `c:${c.id}`, kind: 'tree', weight: 1, samples: [] })
    }
    for (const b of brands) {
      add({ id: `b:${b.id}`, kind: 'brand', label: b.name, href: `/app/kb?b=${b.id}`, logo: b.logo_path })
      const parent = b.cluster_id && usedClusters.some((c) => c.id === b.cluster_id) ? `c:${b.cluster_id}` : 'group'
      links.push({ id: `t:${parent}-${b.id}`, source: parent, target: `b:${b.id}`, kind: 'tree', weight: 1, samples: [] })
    }
    if (showProducts) {
      for (const p of products) {
        add({ id: `p:${p.id}`, kind: 'product', label: p.name, href: `/app/kb/${p.id}`, logo: p.logo_path })
        const parent = p.brand_id && byId.get(p.brand_id)?.status === 'active' ? `b:${p.brand_id}` : 'group'
        links.push({ id: `t:${parent}-${p.id}`, source: parent, target: `p:${p.id}`, kind: 'tree', weight: 1, samples: [] })
      }
    }

    if (showMentions) {
      // czego szukamy w treści faktów: nazwy i skróty marek, nazwy produktów
      const targets: { id: string; test(text: string, plain: string): boolean }[] = [
        ...brands.map((b) => {
          const long = [b.name, ...b.aliases].filter((n) => n.length > 4).map((n) => bare(n)).filter(Boolean)
          const short = b.aliases.filter((n) => n.length <= 4).map((n) => new RegExp(`(^|[^\\p{L}])${escape(n)}([^\\p{L}]|$)`, 'u'))
          return { id: `b:${b.id}`, test: (text: string, plain: string) => long.some((n) => plain.includes(n)) || short.some((re) => re.test(text)) }
        }),
        ...(showProducts ? products.filter((p) => bare(p.name).length >= 5).map((p) => ({ id: `p:${p.id}`, test: (_: string, plain: string) => plain.includes(bare(p.name)) })) : []),
      ]
      const parentOf = new Map(links.filter((l) => l.kind === 'tree').map((l) => [l.target as string, l.source as string]))
      const byPair = new Map<string, MapLink>()
      for (const f of facts ?? []) {
        let owner = ownerOf(f)
        if (!showProducts && owner.startsWith('p:')) owner = f.brand_id && byId.get(f.brand_id)?.status === 'active' ? `b:${f.brand_id}` : 'group'
        const text = `${f.title}\n${f.body}`
        const plain = bare(text)
        for (const t of targets) {
          // własna marka lub produkt i ich rodzic nie są „powiązaniem”
          if (t.id === owner || parentOf.get(owner) === t.id || parentOf.get(t.id) === owner) continue
          if (!t.test(text, plain)) continue
          const key = `${owner}>${t.id}`
          const link = byPair.get(key) ?? { id: `m:${key}`, source: owner, target: t.id, kind: 'mention' as const, weight: 0, samples: [] }
          link.weight++
          if (link.samples.length < 5) link.samples.push(f.title)
          byPair.set(key, link)
        }
      }
      links.push(...byPair.values())
    }
    return { nodes, links, factsOf }
  }, [facts, products, brands, rows, byId, group, showProducts, showMentions])

  // ── układ (siły) ──
  const [, setFrame] = useState(0)
  const sim = useRef<ReturnType<typeof forceSimulation<MapNode>> | null>(null)
  useEffect(() => {
    const s = forceSimulation(graph.nodes)
      .force('link', forceLink<MapNode, MapLink>(graph.links).id((n) => n.id)
        .distance((l) => l.kind === 'mention' ? 260 : (l.target as MapNode).kind === 'product' ? 90 : (l.target as MapNode).kind === 'brand' ? 130 : 170)
        .strength((l) => l.kind === 'mention' ? 0.04 : 0.85))
      .force('charge', forceManyBody<MapNode>().strength((n) => n.kind === 'product' ? -260 : n.kind === 'cluster' ? -420 : -900))
      // podpis też zajmuje miejsce: węzły rozsuwają się tak, żeby nazwy na siebie nie wchodziły
      .force('collide', forceCollide<MapNode>().radius((n) => Math.max(n.r + 16, Math.min(90, n.label.length * (n.kind === 'product' ? 3.3 : 3.8)))).iterations(3))
      .force('x', forceX(0).strength(0.035))
      .force('y', forceY(0).strength(0.05))
      .stop()
    s.tick(420)
    sim.current = s
    s.on('tick', () => setFrame((f) => f + 1))
    setFrame((f) => f + 1)
    return () => { s.stop() }
  }, [graph])

  // ── widok: przesuwanie, zoom, przeciąganie węzłów ──
  const box = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const fit = () => {
    const el = box.current
    if (!el || !graph.nodes.length) return
    const xs = graph.nodes.map((n) => n.x ?? 0), ys = graph.nodes.map((n) => n.y ?? 0)
    const w = Math.max(...xs) - Math.min(...xs) + 160, h = Math.max(...ys) - Math.min(...ys) + 120
    const k = Math.min(1.4, Math.min(el.clientWidth / w, el.clientHeight / h))
    setView({ k, x: el.clientWidth / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: el.clientHeight / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [graph])
  const drag = useRef<{ mode: 'pan' | 'node'; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const toWorld = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }
  }
  const onDown = (e: React.PointerEvent, id?: string) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = { mode: id ? 'node' : 'pan', id, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    if (id) sim.current?.alphaTarget(0.25).restart()
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true
    if (d.mode === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
    else {
      const n = graph.nodes.find((x) => x.id === d.id)
      if (n) { const p = toWorld(e.clientX, e.clientY); n.fx = p.x; n.fy = p.y }
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.mode === 'node') {
      sim.current?.alphaTarget(0)
      const n = graph.nodes.find((x) => x.id === d.id)
      if (n) { n.fx = null; n.fy = null }
      if (!d.moved) setSelected((cur) => (cur === d.id ? null : d.id!))
    } else if (!d.moved) setSelected(null)
  }
  const zoom = (factor: number, cx?: number, cy?: number) => {
    const el = box.current!
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2
    setView((v) => {
      const k = Math.min(3, Math.max(0.25, v.k * factor))
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
    })
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  if (loading && !facts) return <Loading />

  const active = hover ?? selected
  const near = new Set<string>()
  if (active) {
    near.add(active)
    for (const l of graph.links) {
      const s = (l.source as MapNode).id, t = (l.target as MapNode).id
      if (s === active) near.add(t)
      if (t === active) near.add(s)
    }
  }
  const sel = graph.nodes.find((n) => n.id === selected)
  const selLinks = sel ? graph.links.filter((l) => l.kind === 'mention' && ((l.source as MapNode).id === sel.id || (l.target as MapNode).id === sel.id)) : []
  const mentions = graph.links.filter((l) => l.kind === 'mention')

  return (
    <div className="kmap">
      <div className="kmap__bar">
        <Toggle checked={showProducts} onChange={setShowProducts} label="Produkty" />
        <Toggle checked={showMentions} onChange={setShowMentions} label={`Powiązania z faktów · ${mentions.length}`} />
        <span className="grow" />
        <span className="kmap__legend"><i className="kmap__lg kmap__lg--tree" />struktura<i className="kmap__lg kmap__lg--mention" />fakt wspomina</span>
        <IconBtn label="Pomniejsz" onClick={() => zoom(1 / 1.25)}><Minus size={16} /></IconBtn>
        <IconBtn label="Powiększ" onClick={() => zoom(1.25)}><Plus size={16} /></IconBtn>
        <IconBtn label="Dopasuj" onClick={fit}><Maximize2 size={16} /></IconBtn>
      </div>
      <div className="kmap__stage">
        <svg ref={box} className="kmap__svg" onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {graph.links.map((l) => {
              const s = l.source as MapNode, t = l.target as MapNode
              const on = !active || (near.has(s.id) && near.has(t.id) && (s.id === active || t.id === active))
              if (l.kind === 'tree') return <line key={l.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} className={cx('kmap__tree', !on && 'is-dim')} />
              // powiązanie z faktów: łuk, grubość = liczba faktów
              const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2 + ((t.y ?? 0) - (s.y ?? 0)) * 0.18
              const my = ((s.y ?? 0) + (t.y ?? 0)) / 2 - ((t.x ?? 0) - (s.x ?? 0)) * 0.18
              return <path key={l.id} d={`M${s.x},${s.y} Q${mx},${my} ${t.x},${t.y}`} className={cx('kmap__mention', !on && 'is-dim')} strokeWidth={Math.min(7, 1.5 + l.weight)} />
            })}
            {graph.nodes.map((n) => {
              const dim = active && !near.has(n.id)
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} className={cx('kmap__node', `kmap__node--${n.kind}`, dim && 'is-dim', n.id === selected && 'is-on')}
                  onPointerDown={(e) => onDown(e, n.id)} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                  {n.kind === 'cluster'
                    ? <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={3} transform="rotate(45)" />
                    : <circle r={n.r} />}
                  {(n.kind === 'brand' || n.kind === 'group') && <text className="kmap__ini" dy="0.35em">{initials(n.label)}</text>}
                  <text className="kmap__label" y={n.r + (n.kind === 'product' ? 12 : 16)}>{n.label}</text>
                </g>
              )
            })}
          </g>
        </svg>

        {sel && (
          <aside className="kmap__panel">
            <small className="muted">{sel.kind === 'group' ? 'Cała grupa' : sel.kind === 'cluster' ? 'Kategoria' : sel.kind === 'brand' ? 'Marka' : 'Produkt'}</small>
            <b className="kmap__pname">{sel.label}</b>
            <span className="muted">{sel.facts} {sel.facts === 1 ? 'fakt' : 'faktów'} wprost{sel.kind === 'brand' ? ` · ${products.filter((p) => `b:${p.brand_id}` === sel.id).length} produktów` : ''}</span>
            {sel.href && <Link to={sel.href} className="btn btn--ghost btn--sm"><span>Otwórz</span><ArrowUpRight size={15} /></Link>}
            {selLinks.length > 0 && (
              <div className="kmap__rel">
                <small className="eyebrow">Powiązania z faktów</small>
                {selLinks.sort((a, b) => b.weight - a.weight).map((l) => {
                  const out = (l.source as MapNode).id === sel.id
                  const other = (out ? l.target : l.source) as MapNode
                  return (
                    <div key={l.id} className="kmap__relrow">
                      <button type="button" onClick={() => setSelected(other.id)}>{out ? 'Wspomina' : 'Wspomina ją'}: <b>{other.label}</b> · {l.weight}</button>
                      <ul>{l.samples.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  )
                })}
              </div>
            )}
            {(graph.factsOf.get(sel.id) ?? []).length > 0 && (
              <div className="kmap__rel">
                <small className="eyebrow">Fakty</small>
                <ul>{(graph.factsOf.get(sel.id) ?? []).slice(0, 8).map((f) => <li key={f.id}>{f.title}</li>)}</ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
