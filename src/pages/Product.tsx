import { Archive, Bell, BellOff, CalendarDays, Check, ClipboardPaste, Inbox, MoreHorizontal, PenLine, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { emitChanged, Page, useChanged } from '../app/Shell'
import { usePeople } from '../app/people'
import { useCompany, useQuery, useSession } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { HistoryList } from '../components/History'
import { EntryEditor, ImportText, ProductEditor, ProductIcon, SourceTag, StateBadge, useTypeLabels } from '../components/kb'
import { Markdown } from '../components/Markdown'
import { Button, cx, Empty, IconBtn, Loading, Menu, MenuItem, Tabs, useFeedback } from '../components/ui'
import { fmtDate, fmtWhen } from '../lib/format'
import { flash, leave } from '../lib/motion'
import { supabase } from '../lib/supabase'
import type { Collection, Entry, EntryType, FileRow, HistoryRow, Product } from '../lib/types'

type Tab = 'entries' | 'files' | 'history'
const ORDER: EntryType[] = ['announcement', 'news', 'price', 'date', 'fact', 'faq', 'link', 'document']

export default function ProductPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const company = useCompany()
  const { profile, canManage } = useSession()
  const { names, members } = usePeople()
  const types = useTypeLabels()
  const { fail, toast, confirm } = useFeedback()
  const [tab, setTab] = useState<Tab>('entries')
  const [editProduct, setEditProduct] = useState(false)
  const [entryEditor, setEntryEditor] = useState<{ entry?: Entry } | null>(null)
  const [importing, setImporting] = useState(false)
  const highlight = params.get('e')

  const { data, loading, reload } = useQuery(async () => {
    const [{ data: product }, { data: entries }, { data: files }, { data: history }, { data: collections }, { data: sub }] = await Promise.all([
      supabase.from('products_v').select('*').eq('id', id!).maybeSingle(),
      supabase.from('entries').select('*').eq('product_id', id!).neq('status', 'archived').order('importance', { ascending: false }).order('updated_at', { ascending: false }),
      supabase.from('files').select('*').eq('product_id', id!).order('created_at', { ascending: false }),
      supabase.from('history').select('*').eq('product_id', id!).order('created_at', { ascending: false }).limit(80),
      supabase.from('collections').select('*').eq('company_id', company.id).order('position'),
      supabase.from('subscriptions').select('product_id').eq('product_id', id!).eq('user_id', profile!.id).maybeSingle(),
    ])
    return {
      product: product as Product | null, entries: (entries ?? []) as Entry[], files: (files ?? []) as FileRow[],
      history: (history ?? []) as HistoryRow[], collections: (collections ?? []) as Collection[], subscribed: !!sub,
    }
  }, [id, company.id])
  useChanged(useCallback(() => { reload() }, [reload]))

  useEffect(() => {
    if (!highlight || !data) return
    document.getElementById(`e-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, data])

  const groups = useMemo(() => ORDER.map((type) => [type, (data?.entries ?? []).filter((e) => e.type === type)] as const).filter(([, list]) => list.length), [data])

  if (loading && !data) return <Loading />
  const p = data?.product
  if (!p) return <Page crumb="Baza wiedzy"><Empty title="Nie znaleziono produktu" action={<Link className="btn btn--ghost" to="/app/kb">Do bazy wiedzy</Link>} /></Page>

  const today = new Date().toISOString().slice(0, 10)
  const expired = (e: Entry) => e.status === 'review' || (!!e.effective_to && e.effective_to < today)

  const subscribe = async () => {
    if (data.subscribed) await supabase.from('subscriptions').delete().eq('product_id', p.id).eq('user_id', profile!.id)
    else await supabase.from('subscriptions').insert({ product_id: p.id, user_id: profile!.id })
    toast(data.subscribed ? 'Obserwowanie wyłączone' : 'Dowiesz się o każdej zmianie tego produktu')
    reload()
  }
  const verifyAll = async () => {
    const now = new Date().toISOString()
    await Promise.all([
      supabase.from('products').update({ last_verified_at: now, status: 'current' }).eq('id', p.id),
      supabase.from('entries').update({ verified_at: now, status: 'current' }).eq('product_id', p.id).eq('status', 'review'),
    ])
    toast('Oznaczono jako aktualne')
    emitChanged()
  }
  const setOwner = async (owner_id: string | null) => {
    const { error } = await supabase.from('products').update({ owner_id }).eq('id', p.id)
    if (error) return fail(error.message)
    emitChanged()
  }
  const archive = async () => {
    if (!(await confirm({ title: 'Przenieść produkt do archiwum?', text: 'Zniknie z katalogu i odpowiedzi AI. Można go przywrócić z historii.', action: 'Do archiwum' }))) return
    await supabase.from('products').update({ status: 'archived' }).eq('id', p.id)
    emitChanged()
    nav('/app/kb')
  }
  const removeProduct = async () => {
    if (!(await confirm({ title: 'Usunąć produkt na zawsze?', text: 'Razem z nim zostaną usunięte wszystkie wpisy. Tej akcji nie można cofnąć.', action: 'Usuń', danger: true }))) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) return fail(error.message)
    emitChanged()
    nav('/app/kb')
  }
  const entryAction = async (e: Entry, action: 'verify' | 'archive') => {
    const patch = action === 'verify' ? { status: 'current', verified_at: new Date().toISOString(), ...(e.effective_to && e.effective_to < today ? { effective_to: null } : {}) } : { status: 'archived' }
    const { error } = await supabase.from('entries').update(patch).eq('id', e.id)
    if (error) return fail(error.message)
    await (action === 'archive' ? leave(e.id) : flash(e.id))
    emitChanged()
  }

  return (
    <Page crumb={<><Link to="/app/kb">Baza wiedzy</Link>/<b>{p.name}</b></>}>
      <header className="phead">
        <ProductIcon icon={p.icon} accent size={64} />
        <div className="phead__main">
          <div className="phead__badges"><StateBadge state={p.state} />{p.kind && <span className="muted">{p.kind}</span>}</div>
          <h1>{p.name}</h1>
          {p.summary && <p>{p.summary}</p>}
        </div>
        <div className="page__actions">
          <Button icon={data.subscribed ? <BellOff size={17} /> : <Bell size={17} />} onClick={subscribe}>{data.subscribed ? 'Nie obserwuj' : 'Obserwuj'}</Button>
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEntryEditor({})}>Dodaj wpis</Button>
          <Menu trigger={(_, toggle) => <IconBtn label="Więcej" onClick={toggle}><MoreHorizontal size={19} /></IconBtn>}>
            {(close) => (
              <>
                <MenuItem icon={<PenLine size={17} />} onClick={() => { close(); setEditProduct(true) }}>Edytuj produkt</MenuItem>
                <MenuItem icon={<ClipboardPaste size={17} />} onClick={() => { close(); setImporting(true) }}>Wklej tekst → fakty</MenuItem>
                <MenuItem icon={<Archive size={17} />} onClick={() => { close(); archive() }}>Do archiwum</MenuItem>
                {canManage && <MenuItem danger icon={<Trash2 size={17} />} onClick={() => { close(); removeProduct() }}>Usuń</MenuItem>}
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className="pmeta">
        <Menu align="left" trigger={(_, toggle) => (
          <button type="button" className="pmeta__item" onClick={toggle}>
            <UserRound size={16} /><span className="muted">Odpowiedzialny</span>
            <b>{p.owner_id ? names[p.owner_id] ?? '—' : 'nie wyznaczono'}</b>
          </button>
        )}>
          {(close) => (
            <>
              {members.map((m) => <MenuItem key={m.user_id} active={m.user_id === p.owner_id} icon={m.user_id === p.owner_id ? <Check size={17} /> : <span className="menu__gap" />} onClick={() => { close(); setOwner(m.user_id) }}>{m.profile.full_name || m.profile.email}</MenuItem>)}
              {p.owner_id && <><div className="menu__sep" /><MenuItem onClick={() => { close(); setOwner(null) }}>Usuń odpowiedzialnego</MenuItem></>}
            </>
          )}
        </Menu>
        <span className="pmeta__item"><CalendarDays size={16} /><span className="muted">Zaktualizowano</span><b>{fmtWhen(p.last_change)}</b></span>
        {p.last_verified_at && <span className="pmeta__item"><ShieldCheck size={16} /><span className="muted">Sprawdzono</span><b>{fmtDate(p.last_verified_at)}</b></span>}
      </div>

      {p.state === 'review' && (
        <div className="notice">
          <div>
            <b>{p.pending_count > 0 ? 'Są propozycje zmian dla tego produktu' : 'Produkt dawno nie był potwierdzany'}</b>
            <span>{p.pending_count > 0
              ? 'AI znalazło nową informację w poczcie, kalendarzu lub Claude i czeka na Twoją decyzję.'
              : 'Przejrzyj wpisy i potwierdź, że wszystko jest nadal aktualne.'}</span>
          </div>
          {p.pending_count > 0
            ? <Link to="/app/review" className="btn btn--primary"><Inbox size={17} /><span>Otwórz sprawdzanie · {p.pending_count}</span></Link>
            : <Button variant="primary" icon={<ShieldCheck size={17} />} onClick={verifyAll}>Wszystko aktualne</Button>}
        </div>
      )}

      {p.description && <div className="pdesc"><Markdown text={p.description} /></div>}

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'entries', label: 'Materiały', count: data.entries.length },
        { value: 'files', label: 'Zdjęcia i pliki', count: data.files.length },
        { value: 'history', label: 'Machina czasu', count: data.history.length },
      ]} />

      <div className="ptab">
        {tab === 'entries' && (groups.length === 0 ? (
          <Empty title="Nie ma jeszcze żadnego wpisu"
            text="Dodaj cenę, termin lub fakt — albo wklej tekst oferty, a AI rozłoży go samo."
            action={<div className="row"><Button variant="primary" icon={<Plus size={18} />} onClick={() => setEntryEditor({})}>Dodaj wpis</Button><Button icon={<ClipboardPaste size={17} />} onClick={() => setImporting(true)}>Wklej tekst</Button></div>} />
        ) : groups.map(([type, list]) => (
          <section key={type} className="egroup">
            <h3 className="eyebrow">{types[type]} · {list.length}</h3>
            {list.map((e) => (
              <article key={e.id} id={`e-${e.id}`} data-id={e.id} className={cx('entry', highlight === e.id && 'is-hit', expired(e) && 'is-stale')}>
                <div className="entry__main">
                  <h4>{e.title}{e.importance >= 2 && <span className="entry__imp">{e.importance === 3 ? 'Pilne' : 'Ważne'}</span>}</h4>
                  {e.body && <p>{e.body}</p>}
                  <div className="entry__meta">
                    {(e.effective_from || e.effective_to) && (
                      <span><CalendarDays size={13} />{e.effective_from && `${'od'} ${fmtDate(e.effective_from)}`}{e.effective_to && ` ${'do'} ${fmtDate(e.effective_to)}`}</span>
                    )}
                    <SourceTag source={e.source} label={e.source_label} />
                    <span>{fmtWhen(e.updated_at)}</span>
                    {expired(e) && <span className="entry__stale">do sprawdzenia</span>}
                  </div>
                </div>
                <div className="entry__acts">
                  {expired(e) && <IconBtn label="Potwierdź: aktualne" onClick={() => entryAction(e, 'verify')}><ShieldCheck size={17} /></IconBtn>}
                  <IconBtn label="Edytuj" onClick={() => setEntryEditor({ entry: e })}><PenLine size={16} /></IconBtn>
                  <IconBtn label="Do archiwum" onClick={() => entryAction(e, 'archive')}><Archive size={16} /></IconBtn>
                </div>
              </article>
            ))}
          </section>
        )))}

        {tab === 'files' && <FileGrid files={data.files} productId={p.id} onChange={reload} />}

        {tab === 'history' && (data.history.length
          ? <HistoryList rows={data.history} people={names} onChange={reload} />
          : <Empty title="Historia jest pusta" />)}
      </div>

      <ProductEditor open={editProduct} product={p} collections={data.collections} onClose={() => setEditProduct(false)} />
      <EntryEditor open={!!entryEditor} entry={entryEditor?.entry} productId={p.id} onClose={() => setEntryEditor(null)} />
      <ImportText open={importing} productId={p.id} onClose={() => setImporting(false)} />
    </Page>
  )
}
