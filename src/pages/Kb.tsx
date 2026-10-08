import { ArrowUpRight, ChevronDown, Clock, FileText, FolderPlus, Globe, LayoutGrid, List, Plus, Search, SlidersHorizontal, ClipboardPaste } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { emitChanged, Page, useChanged } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { Mark } from '../brand/Logo'
import { ImportText, ProductEditor, ProductIcon, StateBadge } from '../components/kb'
import { Button, Empty, Field, Loading, Menu, MenuItem, Modal, Segmented, Tabs, useFeedback } from '../components/ui'
import { fmtWhen, plural } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Collection, Product } from '../lib/types'

type Tab = 'all' | 'current' | 'review'
type Sort = 'new' | 'name' | 'size'

export default function KbPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { fail } = useFeedback()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const collectionId = params.get('c')
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('aurora_kb_view') as 'grid' | 'list') || 'grid')
  const [editor, setEditor] = useState(false)
  const [importing, setImporting] = useState(false)
  const [newCollection, setNewCollection] = useState<string | null>(null)

  const { data, loading, reload } = useQuery(async () => {
    const [{ data: products }, { data: collections }, { count }] = await Promise.all([
      supabase.from('products_v').select('*').eq('company_id', company.id).neq('status', 'archived'),
      supabase.from('collections').select('*').eq('company_id', company.id).order('position'),
      supabase.from('entries').select('id', { count: 'exact', head: true }).eq('company_id', company.id).neq('status', 'archived'),
    ])
    return { products: (products ?? []) as Product[], collections: (collections ?? []) as Collection[], total: count ?? 0 }
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))

  const inCollection = useMemo(() => (data?.products ?? []).filter((p) => !collectionId || p.collection_id === collectionId), [data, collectionId])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return inCollection
      .filter((p) => tab === 'all' || p.state === tab)
      .filter((p) => !needle || `${p.name} ${p.kind} ${p.summary}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.entries_count - a.entries_count : +new Date(b.last_change) - +new Date(a.last_change))
  }, [inCollection, tab, q, sort])

  const collection = data?.collections.find((c) => c.id === collectionId)
  const sortLabel = { new: 'Najpierw nowe', name: 'Według nazwy', size: 'Według objętości' }
  const materials = (n: number) => `${n} ${plural(n, ['materiał', 'materiały', 'materiałów'])}`
  const lastChange = (data?.products ?? []).reduce((max, p) => (p.last_change > max ? p.last_change : max), '')

  const addCollection = async () => {
    const name = newCollection?.trim()
    if (!name) return
    const { error } = await supabase.from('collections').insert({ company_id: company.id, name, position: data?.collections.length ?? 0 })
    if (error) return fail(error.message)
    setNewCollection(null)
    emitChanged()
  }

  if (loading && !data) return <Loading />

  return (
    <Page crumb={<><Link to="/app/kb">Baza wiedzy</Link>/<b>{collection?.name ?? 'Wszystkie produkty'}</b></>}>
      <div className="page__head">
        <div>
          <h1>{collection?.name ?? 'Baza wiedzy marki'}</h1>
          <p>Produkty, projekty i aktualne materiały Twojego zespołu.</p>
        </div>
        <div className="page__actions">
          <Menu trigger={(_, toggle) => <Button onClick={toggle} trailing={<ChevronDown size={16} />}>Import</Button>}>
            {(close) => (
              <>
                <MenuItem icon={<ClipboardPaste size={17} />} onClick={() => { close(); setImporting(true) }}>Wklej tekst</MenuItem>
                <MenuItem icon={<FileText size={17} />} onClick={() => { close(); nav('/app/files') }}>Z pliku (PDF, DOCX)</MenuItem>
                <MenuItem icon={<Globe size={17} />} onClick={() => { close(); nav('/app/integrations#site') }}>Ze strony firmy</MenuItem>
                {canManage && <><div className="menu__sep" /><MenuItem icon={<FolderPlus size={17} />} onClick={() => { close(); setNewCollection('') }}>Nowa kolekcja</MenuItem></>}
              </>
            )}
          </Menu>
          <Button variant="accent" size="lg" icon={<Plus size={20} />} onClick={() => setEditor(true)}>Dodaj produkt</Button>
        </div>
      </div>

      <Link to="/app/brand/strategy" className="brandbar">
        <Mark size={40} />
        <span className="grow">
          <b>Wszystko zaczyna się od marki</b>
          <small>Strategia, identyfikacja, odbiorcy i tone of voice</small>
        </span>
        <span className="brandbar__go">O marce<ArrowUpRight size={18} /></span>
      </Link>

      <div className="kb__tools">
        <div className="search kb__search">
          <Search size={18} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Znajdź produkt, projekt lub materiał" />
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
          { value: 'all', label: 'Wszystkie produkty', count: inCollection.length },
          { value: 'current', label: 'Aktualne', count: inCollection.filter((p) => p.state === 'current').length },
          { value: 'review', label: 'Do sprawdzenia', count: inCollection.filter((p) => p.state === 'review').length },
        ]} />
        <span className="kb__total">{materials(data?.total ?? 0)} w bazie</span>
      </div>

      {shown.length === 0 ? (
        <Empty
          icon={<LayoutGrid size={24} />}
          title={q || tab !== 'all' ? 'Nic nie znaleziono' : 'Tutaj pojawią się Twoje produkty'}
          text={q || tab !== 'all' ? undefined : 'Dodaj pierwszy produkt ręcznie, wklej tekst oferty lub zaimportuj stronę — AI rozłoży wszystko na karty.'}
          action={!q && tab === 'all' && <Button variant="accent" icon={<Plus size={18} />} onClick={() => setEditor(true)}>Dodaj produkt</Button>}
        />
      ) : view === 'grid' ? (
        <div className="pgrid">
          {shown.map((p, i) => (
            <Link key={p.id} to={`/app/kb/${p.id}`} className="pcard" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <div className="pcard__top"><ProductIcon icon={p.icon} accent={i === 0} /><StateBadge state={p.state} /></div>
              <div className="pcard__name"><h3 className="truncate">{p.name}</h3>{p.kind && <span>{p.kind}</span>}</div>
              <p>{p.summary || 'Opis nie został jeszcze dodany.'}</p>
              <div className="pcard__foot">
                <span><FileText size={15} />{materials(p.entries_count)}</span>
                <span className="pcard__when">{fmtWhen(p.last_change)}<ArrowUpRight size={15} /></span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="plist">
          {shown.map((p) => (
            <Link key={p.id} to={`/app/kb/${p.id}`} className="plist__row">
              <ProductIcon icon={p.icon} size={38} />
              <span className="plist__name"><b className="truncate">{p.name}</b><small className="truncate">{p.summary}</small></span>
              <span className="plist__kind">{p.kind}</span>
              <span className="plist__n">{materials(p.entries_count)}</span>
              <StateBadge state={p.state} />
              <span className="plist__when">{fmtWhen(p.last_change)}</span>
            </Link>
          ))}
        </div>
      )}

      {lastChange && (
        <div className="kb__foot">
          <span><Clock size={15} />Ostatnia aktualizacja: {fmtWhen(lastChange).toLowerCase()}</span>
          <span>Aktualna wiedza. Silna marka.</span>
        </div>
      )}

      <ProductEditor open={editor} collections={data?.collections ?? []} defaultCollection={collectionId} onClose={(id) => { setEditor(false); if (id) nav(`/app/kb/${id}`) }} />
      <ImportText open={importing} onClose={() => setImporting(false)} />
      <Modal open={newCollection !== null} onClose={() => setNewCollection(null)} width={420} title="Nowa kolekcja"
        footer={<><Button onClick={() => setNewCollection(null)}>Anuluj</Button><Button variant="primary" disabled={!newCollection?.trim()} onClick={addCollection}>Utwórz</Button></>}>
        <Field label="Nazwa"><input className="input" autoFocus value={newCollection ?? ''} onChange={(e) => setNewCollection(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCollection()} /></Field>
      </Modal>
    </Page>
  )
}
