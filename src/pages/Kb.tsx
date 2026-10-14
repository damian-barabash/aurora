import { Archive, ArrowUpRight, ChevronDown, Clock, ClipboardPaste, FileText, FolderPlus, Globe, LayoutGrid, List, MoreHorizontal, PenLine, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandMark, useBrands } from '../app/brands'
import { emitChanged, Page, useChanged } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { Mark } from '../brand/Logo'
import { BrandEditor } from '../components/BrandEditor'
import { CollectionEditor, EntryEditor, ImportText, ProductEditor, ProductIcon, SourceTag, StateBadge, useTypeLabels, VisibilityBadge } from '../components/kb'
import { Button, cx, Empty, IconBtn, Loading, Menu, MenuItem, Segmented, Tabs, useFeedback } from '../components/ui'
import { fmtDate, fmtWhen, plural } from '../lib/format'
import { leave } from '../lib/motion'
import { supabase } from '../lib/supabase'
import { useSigned } from '../lib/useSigned'
import type { Brand, Collection, Entry, EntryType, Product } from '../lib/types'

type Tab = 'all' | 'current' | 'review'
type Sort = 'new' | 'name' | 'size'
const ORDER: EntryType[] = ['announcement', 'news', 'price', 'date', 'fact', 'faq', 'link', 'document']

export default function KbPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { brands, byId, clusters, group } = useBrands()
  const { fail, confirm } = useFeedback()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const collectionId = params.get('c')
  const brandParam = params.get('b')
  /** undefined = cały katalog, null = cała grupa, string = marka */
  const brandScope: string | null | undefined = brandParam === 'group' ? null : brandParam ?? undefined
  const brand = brandScope ? byId.get(brandScope) ?? null : null
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('aurora_kb_view') as 'grid' | 'list') || 'grid')
  const [editor, setEditor] = useState(false)
  const [importing, setImporting] = useState(false)
  const [collectionEditor, setCollectionEditor] = useState<{ collection?: Collection } | null>(null)
  const [brandEditor, setBrandEditor] = useState<{ brand?: Brand } | null>(null)

  const { data, loading, reload } = useQuery(async () => {
    let general = supabase.from('entries').select('*').eq('company_id', company.id).is('product_id', null).neq('status', 'archived')
    general = brandScope ? general.eq('brand_id', brandScope) : general.is('brand_id', null)
    const [{ data: products }, { data: collections }, { count }, { data: entries }] = await Promise.all([
      supabase.from('products_v').select('*').eq('company_id', company.id).neq('status', 'archived'),
      supabase.from('collections').select('*').eq('company_id', company.id).order('position'),
      supabase.from('entries').select('id', { count: 'exact', head: true }).eq('company_id', company.id).neq('status', 'archived'),
      brandScope !== undefined ? general.order('importance', { ascending: false }).order('updated_at', { ascending: false }) : Promise.resolve({ data: [] }),
    ])
    return {
      products: (products ?? []) as Product[], collections: (collections ?? []) as Collection[],
      total: count ?? 0, general: (entries ?? []) as Entry[],
    }
  }, [company.id, brandScope])
  useChanged(useCallback(() => { reload() }, [reload]))

  const inScope = useMemo(() => (data?.products ?? [])
    .filter((p) => !collectionId || p.collection_id === collectionId)
    .filter((p) => brandScope === undefined || (p.brand_id ?? null) === brandScope), [data, collectionId, brandScope])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return inScope
      .filter((p) => tab === 'all' || p.state === tab)
      .filter((p) => !needle || `${p.name} ${p.kind} ${p.summary} ${byId.get(p.brand_id ?? '')?.name ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.entries_count - a.entries_count : +new Date(b.last_change) - +new Date(a.last_change))
  }, [inScope, tab, q, sort, byId])

  // katalog bez filtra: marka > produkty, w kolejności klastrów
  const sections = useMemo(() => {
    if (brandScope !== undefined || collectionId) return [{ key: 'all', brand: undefined as Brand | null | undefined, items: shown }]
    const out: { key: string; brand: Brand | null | undefined; items: Product[] }[] = []
    for (const c of clusters) for (const b of c.brands) {
      const items = shown.filter((p) => p.brand_id === b.id)
      if (items.length) out.push({ key: b.id, brand: b, items })
    }
    const loose = shown.filter((p) => !p.brand_id || !brands.some((b) => b.id === p.brand_id))
    if (loose.length) out.push({ key: 'group', brand: null, items: loose })
    return out
  }, [shown, clusters, brands, brandScope, collectionId])

  const logos = useSigned((data?.products ?? []).map((p) => p.logo_path))
  const collection = data?.collections.find((c) => c.id === collectionId)
  const sortLabel = { new: 'Najpierw nowe', name: 'Według nazwy', size: 'Według objętości' }
  const materials = (n: number) => `${n} ${plural(n, ['materiał', 'materiały', 'materiałów'])}`
  const lastChange = (data?.products ?? []).reduce((max, p) => (p.last_change > max ? p.last_change : max), '')
  const scopeName = brandScope === undefined ? null : brand?.name ?? group

  const removeCollection = async (c: Collection) => {
    if (!(await confirm({ title: `Usunąć kolekcję „${c.name}”?`, text: 'Produkty zostaną w bazie — stracą tylko przypisanie do tej kolekcji.', action: 'Usuń kolekcję', danger: true }))) return
    const { error } = await supabase.from('collections').delete().eq('id', c.id)
    if (error) return fail(error.message)
    emitChanged()
    nav('/app/kb')
  }

  if (loading && !data) return <Loading />

  const card = (p: Product, i: number) => (
    <Link key={p.id} to={`/app/kb/${p.id}`} className="pcard" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      <div className="pcard__top"><ProductIcon icon={p.icon} logo={logos[p.logo_path ?? '']} accent={i === 0} /><StateBadge state={p.state} /></div>
      <div className="pcard__name"><h3 className="truncate">{p.name}</h3>{p.kind && <span>{p.kind}</span>}</div>
      <p>{p.summary || 'Opis nie został jeszcze dodany.'}</p>
      <div className="pcard__foot">
        <span><FileText size={15} />{materials(p.entries_count)}</span>
        <span className="pcard__when">{fmtWhen(p.last_change)}<ArrowUpRight size={15} /></span>
      </div>
    </Link>
  )
  const row = (p: Product) => (
    <Link key={p.id} to={`/app/kb/${p.id}`} className="plist__row">
      <ProductIcon icon={p.icon} logo={logos[p.logo_path ?? '']} size={38} />
      <span className="plist__name"><b className="truncate">{p.name}</b><small className="truncate">{p.summary}</small></span>
      <span className="plist__kind">{p.kind}</span>
      <span className="plist__n">{materials(p.entries_count)}</span>
      <StateBadge state={p.state} />
      <span className="plist__when">{fmtWhen(p.last_change)}</span>
    </Link>
  )

  return (
    <Page crumb={<><Link to="/app/kb">Baza wiedzy</Link>/<b>{collection?.name ?? scopeName ?? 'Wszystkie produkty'}</b></>}>
      <div className="page__head">
        <div>
          <h1>
            {collection?.name ?? (brandScope === undefined ? 'Baza wiedzy' : scopeName)}
            {collection && canManage && (
              <Menu align="left" trigger={(_, toggle) => <IconBtn label="Kolekcja" className="kb__colmenu" onClick={toggle}><MoreHorizontal size={20} /></IconBtn>}>
                {(close) => (
                  <>
                    <MenuItem icon={<PenLine size={17} />} onClick={() => { close(); setCollectionEditor({ collection }) }}>Zmień nazwę</MenuItem>
                    <MenuItem danger icon={<Trash2 size={17} />} onClick={() => { close(); removeCollection(collection) }}>Usuń kolekcję</MenuItem>
                  </>
                )}
              </Menu>
            )}
          </h1>
          <p>{brandScope === undefined ? `${group}: marki, ich produkty i aktualne materiały zespołu.` : brand ? brand.summary || `Produkty i wiedza marki ${brand.name}.` : 'Wiedza wspólna dla wszystkich marek: struktura, zasady, decyzje holdingu.'}</p>
        </div>
        <div className="page__actions">
          <Menu trigger={(_, toggle) => <Button onClick={toggle} trailing={<ChevronDown size={16} />}>Import</Button>}>
            {(close) => (
              <>
                <MenuItem icon={<ClipboardPaste size={17} />} onClick={() => { close(); setImporting(true) }}>Wklej tekst</MenuItem>
                <MenuItem icon={<FileText size={17} />} onClick={() => { close(); nav('/app/files') }}>Z pliku (PDF, DOCX)</MenuItem>
                <MenuItem icon={<Globe size={17} />} onClick={() => { close(); nav('/app/integrations#site') }}>Ze strony marki</MenuItem>
                {canManage && (
                  <>
                    <div className="menu__sep" />
                    <MenuItem icon={<Plus size={17} />} onClick={() => { close(); setBrandEditor({}) }}>Nowa marka</MenuItem>
                    <MenuItem icon={<FolderPlus size={17} />} onClick={() => { close(); setCollectionEditor({}) }}>Nowa kolekcja</MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
          <Button variant="accent" size="lg" icon={<Plus size={20} />} onClick={() => setEditor(true)}>Dodaj produkt</Button>
        </div>
      </div>

      {brandScope === undefined ? (
        <Link to="/app/brand/strategy?b=group" className="brandbar">
          <Mark size={40} />
          <span className="grow">
            <b>Wszystko zaczyna się od marki</b>
            <small>Profil grupy i każdej marki: strategia, identyfikacja, tone of voice</small>
          </span>
          <span className="brandbar__go">O markach<ArrowUpRight size={18} /></span>
        </Link>
      ) : (
        <BrandCard brand={brand} group={group} canManage={canManage} onEdit={() => brand && setBrandEditor({ brand })} />
      )}

      <div className="kb__tools">
        <div className="search kb__search">
          <Search size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Znajdź produkt, markę lub materiał" />
        </div>
        <span className="grow" />
        <Menu trigger={(_, toggle) => <Button variant="quiet" icon={<SlidersHorizontal size={17} />} trailing={<ChevronDown size={15} />} onClick={toggle}>{sortLabel[sort]}</Button>}>
          {(close) => (['new', 'name', 'size'] as Sort[]).map((s) => <MenuItem key={s} active={s === sort} onClick={() => { close(); setSort(s) }}>{sortLabel[s]}</MenuItem>)}
        </Menu>
        <Segmented value={view} onChange={(v) => { setView(v); localStorage.setItem('aurora_kb_view', v) }} options={[
          { value: 'grid', label: <LayoutGrid size={17} /> }, { value: 'list', label: <List size={17} /> },
        ]} />
      </div>

      <div className="kb__tabs">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'all', label: 'Wszystkie produkty', count: inScope.length },
          { value: 'current', label: 'Aktualne', count: inScope.filter((p) => p.state === 'current').length },
          { value: 'review', label: 'Do sprawdzenia', count: inScope.filter((p) => p.state === 'review').length },
        ]} />
        <span className="kb__total">{materials(data?.total ?? 0)} w bazie</span>
      </div>

      {shown.length === 0 ? (
        <Empty
          icon={<LayoutGrid size={24} />}
          title={q || tab !== 'all' ? 'Nic nie znaleziono' : brandScope !== undefined ? 'Ta marka nie ma jeszcze produktów' : 'Tutaj pojawią się Twoje produkty'}
          text={q || tab !== 'all' ? undefined : 'Dodaj produkt ręcznie, wklej tekst oferty lub zaimportuj stronę marki — AI rozłoży wszystko na karty.'}
          action={!q && tab === 'all' && <Button variant="accent" icon={<Plus size={18} />} onClick={() => setEditor(true)}>Dodaj produkt</Button>}
        />
      ) : sections.map((s) => (
        <section key={s.key} className="kb__section">
          {s.brand !== undefined && (
            <Link to={`/app/kb?b=${s.brand?.id ?? 'group'}`} className="kb__brandhead">
              <BrandMark brand={s.brand} group={group} size={30} />
              <b>{s.brand?.name ?? group}</b>
              {s.brand?.cluster && <span className="muted">{s.brand.cluster}</span>}
              <span className="grow" />
              <ArrowUpRight size={17} />
            </Link>
          )}
          {view === 'grid' ? <div className="pgrid">{s.items.map(card)}</div> : <div className="plist">{s.items.map(row)}</div>}
        </section>
      ))}

      {brandScope !== undefined && <GeneralKnowledge entries={data?.general ?? []} brandId={brandScope} scopeName={scopeName ?? ''} />}

      {lastChange && (
        <div className="kb__foot">
          <span><Clock size={15} />Ostatnia aktualizacja: {fmtWhen(lastChange).toLowerCase()}</span>
          <span>Aktualna wiedza. Silna marka.</span>
        </div>
      )}

      <ProductEditor open={editor} collections={data?.collections ?? []} defaultCollection={collectionId} defaultBrand={brandScope ?? null}
        onClose={(id) => { setEditor(false); if (id) nav(`/app/kb/${id}`) }} />
      <ImportText open={importing} brandId={brandScope ?? null} onClose={() => setImporting(false)} />
      <CollectionEditor open={!!collectionEditor} collection={collectionEditor?.collection} onClose={(id) => { const created = !collectionEditor?.collection; setCollectionEditor(null); if (id && created) nav(`/app/kb?c=${id}`) }} />
      <BrandEditor open={!!brandEditor} brand={brandEditor?.brand} onClose={(id) => { const created = !brandEditor?.brand; setBrandEditor(null); if (id && created) nav(`/app/kb?b=${id}`) }} />
    </Page>
  )
}

/** Karta marki nad katalogiem: znak, klaster, strona WWW, profil. Dla `null` — cała grupa. */
function BrandCard({ brand, group, canManage, onEdit }: { brand: Brand | null; group: string; canManage: boolean; onEdit(): void }) {
  const key = brand?.id ?? 'group'
  return (
    <div className="bcard">
      <BrandMark brand={brand} group={group} size={56} />
      <div className="bcard__main">
        <div className="bcard__meta">
          {brand ? <span>{brand.cluster || 'Bez klastra'}</span> : <span>Holding · wiedza wspólna</span>}
          {brand?.aliases.length ? <span className="muted">też: {brand.aliases.join(', ')}</span> : null}
        </div>
        <b className="bcard__name">{brand?.name ?? group}</b>
        {brand?.website && (
          <a className="bcard__site" href={brand.website} target="_blank" rel="noreferrer"><Globe size={15} />{brand.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
        )}
      </div>
      <div className="bcard__acts">
        <Link to={`/app/brand/strategy?b=${key}`} className="btn btn--ghost"><span>Profil marki</span><ArrowUpRight size={17} /></Link>
        {brand && canManage && <Button icon={<PenLine size={16} />} onClick={onEdit}>Edytuj</Button>}
      </div>
    </div>
  )
}

/** Wiedza o samej marce (albo całej grupie) — wpisy bez produktu. */
function GeneralKnowledge({ entries, brandId, scopeName }: { entries: Entry[]; brandId: string | null; scopeName: string }) {
  const types = useTypeLabels()
  const { fail } = useFeedback()
  const [editor, setEditor] = useState<{ entry?: Entry } | null>(null)
  const groups = useMemo(() => ORDER.map((type) => [type, entries.filter((e) => e.type === type)] as const).filter(([, list]) => list.length), [entries])
  const archive = async (e: Entry) => {
    const { error } = await supabase.from('entries').update({ status: 'archived' }).eq('id', e.id)
    if (error) return fail(error.message)
    await leave(e.id)
    emitChanged()
  }
  return (
    <section className="kb__general">
      <div className="kb__generalhead">
        <h2>Wiedza o {brandId ? 'marce' : 'grupie'} <span className="muted">· {entries.length}</span></h2>
        <Button size="sm" icon={<Plus size={16} />} onClick={() => setEditor({})}>Dodaj wpis</Button>
      </div>
      {entries.length === 0 ? (
        <p className="muted">Nie ma jeszcze wpisów o {scopeName}, które nie dotyczą konkretnego produktu: pozycjonowanie, zasady, decyzje, kontakt.</p>
      ) : groups.map(([type, list]) => (
        <div key={type} className="egroup">
          <h3 className="eyebrow">{types[type]} · {list.length}</h3>
          {list.map((e) => (
            <article key={e.id} data-id={e.id} className={cx('entry', e.status === 'review' && 'is-stale')}>
              <div className="entry__main">
                <h4>{e.title}{e.importance >= 2 && <span className="entry__imp">{e.importance === 3 ? 'Pilne' : 'Ważne'}</span>}<VisibilityBadge value={e.visibility} /></h4>
                {e.body && <p>{e.body}</p>}
                <div className="entry__meta">
                  {e.effective_from && <span>od {fmtDate(e.effective_from)}{e.effective_to && ` do ${fmtDate(e.effective_to)}`}</span>}
                  <SourceTag source={e.source} label={e.source_label} />
                  <span>{fmtWhen(e.updated_at)}</span>
                </div>
              </div>
              <div className="entry__acts">
                <IconBtn label="Edytuj" onClick={() => setEditor({ entry: e })}><PenLine size={16} /></IconBtn>
                <IconBtn label="Do archiwum" onClick={() => archive(e)}><Archive size={16} /></IconBtn>
              </div>
            </article>
          ))}
        </div>
      ))}
      <EntryEditor open={!!editor} entry={editor?.entry} brandId={brandId} onClose={() => setEditor(null)} />
    </section>
  )
}
