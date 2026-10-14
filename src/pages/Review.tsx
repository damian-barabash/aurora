import { Check, GitCompareArrows, Inbox, Lock, PenLine, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBrands } from '../app/brands'
import { emitChanged, Page, useChanged } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { BrandSelect, SourceTag, useTypeLabels, VISIBILITY } from '../components/kb'
import { Badge, Button, cx, Empty, Field, Loading, Modal, Segmented, Tabs } from '../components/ui'
import { fmtDate, fmtWhen } from '../lib/format'
import { leave } from '../lib/motion'
import { api, supabase } from '../lib/supabase'
import { background } from '../lib/sync'
import type { Entry, Proposal, Visibility } from '../lib/types'

interface Draft {
  title: string
  body: string
  effective_from: string
  brand_id: string | null
  /** '' = wiedza o marce, 'new' = nowy produkt z propozycji */
  product_id: string
  visibility: Visibility
}

export default function ReviewPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { label, brands } = useBrands()
  const types = useTypeLabels()
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const [brandFilter, setBrandFilter] = useState<string>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // karty zdjęte optymistycznie, zanim serwer potwierdzi decyzję
  const [gone, setGone] = useState<Set<string>>(new Set())
  const hide = (id: string) => setGone((g) => new Set(g).add(id))
  const unhide = (id: string) => setGone((g) => { const n = new Set(g); n.delete(id); return n })
  const [editing, setEditing] = useState<Proposal | null>(null)
  const [draft, setDraft] = useState<Draft>({ title: '', body: '', effective_from: '', brand_id: null, product_id: '', visibility: 'internal' })

  const { data, loading, reload } = useQuery(async () => {
    const [{ data: pending }, { data: done }, { data: products }] = await Promise.all([
      supabase.from('proposals').select('*').eq('company_id', company.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1000),
      supabase.from('proposals').select('*').eq('company_id', company.id).neq('status', 'pending').order('resolved_at', { ascending: false }).limit(100),
      supabase.from('products').select('id, name, brand_id').eq('company_id', company.id).neq('status', 'archived').order('name'),
    ])
    const list = [...(pending ?? []), ...(done ?? [])] as Proposal[]
    const entryIds = [...new Set(list.map((p) => p.entry_id).filter(Boolean))] as string[]
    const { data: entries } = entryIds.length ? await supabase.from('entries').select('*').in('id', entryIds) : { data: [] }
    return {
      list,
      entries: Object.fromEntries(((entries ?? []) as Entry[]).map((e) => [e.id, e])) as Record<string, Entry>,
      products: (products ?? []) as { id: string; name: string; brand_id: string | null }[],
    }
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))
  const productName = useMemo(() => Object.fromEntries((data?.products ?? []).map((p) => [p.id, p.name])) as Record<string, string>, [data])

  const pending = useMemo(() => (data?.list ?? []).filter((p) => p.status === 'pending' && !gone.has(p.id)), [data, gone])
  const done = useMemo(() => (data?.list ?? []).filter((p) => p.status !== 'pending'), [data])
  const scoped = (tab === 'pending' ? pending : done).filter((p) => brandFilter === 'all' || (p.brand_id ?? 'group') === brandFilter)
  // paczki: jeden import (mail, plik, rozmowa z Claude) = jedna paczka
  const batchSize = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of pending) if (p.batch_id) m[p.batch_id] = (m[p.batch_id] ?? 0) + 1
    return m
  }, [pending])
  useEffect(() => setPicked(new Set()), [tab, brandFilter])

  const act = async (p: Proposal, action: 'proposal_apply' | 'proposal_reject', edits?: Record<string, unknown>) => {
    // optymistycznie: karta od razu odjeżdża, serwer dostaje decyzję w tle; przy błędzie wraca na listę
    await leave(p.id, action === 'proposal_apply')
    hide(p.id)
    background(action === 'proposal_apply' ? 'Zatwierdzanie zmiany' : 'Odrzucanie zmiany', async () => {
      await api(action, { id: p.id, edits })
      emitChanged()
    }, () => unhide(p.id))
  }

  const bulk = (decision: 'apply' | 'reject', opts: { ids?: string[]; batch_id?: string }) => {
    const ids = opts.ids ?? pending.filter((p) => p.batch_id === opts.batch_id).map((p) => p.id)
    // optymistycznie: wszystkie karty znikają od razu, decyzja idzie w tle
    setGone((g) => new Set([...g, ...ids]))
    setPicked(new Set())
    background(decision === 'apply' ? `Zatwierdzanie zmian (${ids.length})` : `Odrzucanie zmian (${ids.length})`, async () => {
      await api('proposal_bulk', { company_id: company.id, decision, ids })
      emitChanged()
    }, () => setGone((g) => { const n = new Set(g); ids.forEach((id) => n.delete(id)); return n }))
  }

  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  if (loading && !data) return <Loading />
  const kindLabel = (p: Proposal) => p.kind === 'conflict' ? 'Konflikt źródeł' : p.kind === 'update' ? 'Zmiana' : p.kind === 'new_product' ? 'Nowy produkt' : 'Nowy wpis'
  const where = (p: Proposal) => p.payload.new_brand
    ? `Nowa marka: ${p.payload.new_brand.name}`
    : label(p.brand_id, p.product_id ? productName[p.product_id] : p.payload.new_product?.name)
  const brandOptions = [
    { value: 'all', label: 'Wszystkie' },
    ...[...new Set(pending.map((p) => p.brand_id ?? 'group'))].map((id) => ({
      value: id, label: `${id === 'group' ? label(null) : label(id)} · ${pending.filter((p) => (p.brand_id ?? 'group') === id).length}`,
    })),
  ]
  const openEditor = (p: Proposal) => {
    setEditing(p)
    setDraft({
      title: p.payload.title, body: p.payload.body, effective_from: p.payload.effective_from ?? '',
      brand_id: p.brand_id, product_id: p.product_id ?? (p.payload.new_product ? 'new' : ''), visibility: p.payload.visibility ?? 'internal',
    })
  }
  const applyDraft = () => {
    const p = editing!
    setEditing(null)
    act(p, 'proposal_apply', {
      title: draft.title, body: draft.body, effective_from: draft.effective_from || null, visibility: draft.visibility,
      brand_id: draft.brand_id,
      ...(draft.product_id === 'new' ? {} : { product_id: draft.product_id || null }),
    })
  }
  const allPicked = scoped.length > 0 && scoped.every((p) => picked.has(p.id))

  return (
    <Page className="page--narrow" crumb="Do sprawdzenia">
      <div className="page__head">
        <div>
          <h1>Do sprawdzenia</h1>
          <p>{canManage
            ? 'Trafia tu to, czego AI nie jest pewne: niepotwierdzone zmiany, nowe produkty i marki, sprzeczności między źródłami. Przy zatwierdzaniu możesz poprawić markę i produkt.'
            : 'Tu są Twoje propozycje zmian — z Twojej poczty i Claude. Zdecyduj, co trafi do wspólnej bazy.'}</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: 'Czekają na decyzję', count: pending.length },
        { value: 'done', label: 'Rozpatrzone', count: done.length },
      ]} />

      {tab === 'pending' && pending.length > 0 && (
        <div className="review__bar">
          {brandOptions.length > 2 && (
            <select className="select review__filter" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              {brandOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <label className="review__all">
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(scoped.map((p) => p.id)))} />
            <span>Zaznacz wszystkie ({scoped.length})</span>
          </label>
          <span className="grow" />
          {picked.size > 0 && (
            <>
              <Button variant="primary" icon={<Check size={17} />} onClick={() => bulk('apply', { ids: [...picked] })}>Zastosuj zaznaczone · {picked.size}</Button>
              <Button variant="quiet" icon={<X size={16} />} onClick={() => bulk('reject', { ids: [...picked] })}>Odrzuć</Button>
            </>
          )}
        </div>
      )}

      <div className="feed">
        {scoped.length === 0 && <Empty icon={<Inbox size={24} />} title={tab === 'pending' ? 'Wszystko rozpatrzone' : 'Na razie pusto'}
          text={tab === 'pending' ? 'Nowe propozycje pojawią się, gdy AI znajdzie zmiany w poczcie, kalendarzu, na stronie lub w rozmowie z Claude.' : undefined} />}
        {scoped.map((p, i) => {
          const old = p.entry_id ? data?.entries[p.entry_id] : null
          const firstOfBatch = tab === 'pending' && p.batch_id && (batchSize[p.batch_id] ?? 0) > 1 && scoped.findIndex((x) => x.batch_id === p.batch_id) === i
          return (
            <div key={p.id} className="review__slot">
              {firstOfBatch && (
                <div className="batch">
                  <span><b>Paczka · {batchSize[p.batch_id!]}</b> {p.source_label ?? ''} · {fmtWhen(p.created_at)}</span>
                  <span className="grow" />
                  <Button size="sm" variant="primary" icon={<Check size={15} />} onClick={() => bulk('apply', { batch_id: p.batch_id! })}>Zastosuj całą paczkę</Button>
                  <Button size="sm" variant="quiet" onClick={() => bulk('reject', { batch_id: p.batch_id! })}>Odrzuć paczkę</Button>
                </div>
              )}
              <article data-id={p.id} className={cx('prop', p.kind === 'conflict' && 'prop--conflict', picked.has(p.id) && 'is-picked')}>
                <div className="prop__top">
                  {p.status === 'pending' && <input type="checkbox" className="prop__check" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label="Zaznacz" />}
                  <Badge tone={p.kind === 'conflict' ? 'accent' : 'neutral'} icon={p.kind === 'conflict' ? <GitCompareArrows size={14} /> : undefined}>{kindLabel(p)}</Badge>
                  {p.payload.visibility === 'confidential' && <Badge icon={<Lock size={13} />}>Poufne</Badge>}
                  {p.payload.flag === 'personal' && <Badge tone="accent">Dane osobowe?</Badge>}
                  <SourceTag source={p.source} label={p.source_label} />
                  <span className="grow" />
                  <time className="muted">{fmtWhen(p.created_at)}</time>
                </div>
                <div className="prop__product">
                  {p.product_id && productName[p.product_id]
                    ? <Link to={`/app/kb/${p.product_id}`}>{where(p)}</Link>
                    : <Link to={`/app/kb?b=${p.brand_id ?? 'group'}`}>{where(p)}</Link>}
                  {p.payload.new_product && !p.product_id && <span className="muted"> — {p.payload.new_product.summary}</span>}
                </div>

                {old && (p.kind === 'conflict' || p.kind === 'update') ? (
                  <div className="versus">
                    <div><small>Teraz w bazie</small><b>{old.title}</b><p>{old.body}</p></div>
                    <div className="versus__new"><small>Nowa wersja</small><b>{p.payload.title}</b><p>{p.payload.body}</p></div>
                  </div>
                ) : (
                  <div className="prop__body"><small className="eyebrow">{types[p.payload.type] ?? p.payload.type}</small><b>{p.payload.title}</b><p>{p.payload.body}</p></div>
                )}
                <div className="prop__meta">
                  {p.payload.effective_from && <span>obowiązuje od {fmtDate(p.payload.effective_from)}</span>}
                  {p.confidence != null && <span>pewność {Math.round(p.confidence * 100)}%</span>}
                </div>
                {p.evidence && <p className="prop__why">{p.evidence}</p>}

                {p.status === 'pending' ? (
                  <div className="prop__acts">
                    <Button variant="primary" icon={<Check size={17} />} onClick={() => act(p, 'proposal_apply')}>
                      {p.kind === 'conflict' ? 'Przyjmij nową wersję' : 'Zastosuj'}
                    </Button>
                    <Button icon={<PenLine size={16} />} onClick={() => openEditor(p)}>Popraw i zastosuj</Button>
                    <Button variant="quiet" icon={<X size={16} />} onClick={() => act(p, 'proposal_reject')}>
                      {p.kind === 'conflict' ? 'Zostaw jak w bazie' : 'Odrzuć'}
                    </Button>
                  </div>
                ) : (
                  <div className="prop__done">{p.status === 'applied' ? <><Check size={15} />Zastosowano</> : <><X size={15} />Odrzucono</>}</div>
                )}
              </article>
            </div>
          )
        })}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} width={600} title="Popraw przed zastosowaniem"
        footer={<><Button onClick={() => setEditing(null)}>Anuluj</Button><Button variant="primary" disabled={!draft.title.trim()} onClick={applyDraft}>Zastosuj</Button></>}>
        <div className="form">
          <div className="form__row">
            <Field label="Marka">
              <BrandSelect value={draft.brand_id} onChange={(brand_id) => setDraft({
                ...draft, brand_id,
                // produkt innej marki nie pasuje do nowej marki
                product_id: draft.product_id && draft.product_id !== 'new' && (data?.products.find((x) => x.id === draft.product_id)?.brand_id ?? null) !== brand_id ? '' : draft.product_id,
              })} />
            </Field>
            <Field label="Produkt">
              <select className="select" value={draft.product_id} onChange={(e) => setDraft({ ...draft, product_id: e.target.value })}>
                <option value="">— wiedza o marce, bez produktu —</option>
                {editing?.payload.new_product && !editing.product_id && <option value="new">Nowy: {editing.payload.new_product.name}</option>}
                {(data?.products ?? []).filter((x) => (x.brand_id ?? null) === draft.brand_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </div>
          {!brands.length && <p className="muted">Firma nie ma jeszcze marek.</p>}
          <Field label="Tytuł"><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Treść"><textarea className="textarea" rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
          <div className="form__row">
            <Field label="Obowiązuje od"><input type="date" className="input" value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} /></Field>
            <Field label="Widoczność" hint={VISIBILITY[draft.visibility].hint}>
              <Segmented value={draft.visibility} onChange={(visibility) => setDraft({ ...draft, visibility })}
                options={(['public', 'internal', 'confidential'] as Visibility[]).map((v) => ({ value: v, label: VISIBILITY[v].label }))} />
            </Field>
          </div>
        </div>
      </Modal>
    </Page>
  )
}
