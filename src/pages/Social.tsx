import {
  Bookmark, CalendarClock, Check, CircleCheck, Clock, Film, Globe, Heart, ImagePlus, MessageCircle, Plus, Repeat2, RotateCw, Send,
  Sparkles, ThumbsUp, Trash2, TriangleAlert, UserPlus, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '../app/Shell'
import { usePeople } from '../app/people'
import { useCompany, useQuery, useSession } from '../app/session'
import { Avatar, Badge, Button, cx, Empty, Field, IconBtn, Loading, Menu, MenuItem, Modal, Segmented, Tabs, useFeedback } from '../components/ui'
import { fmtWhen, plural } from '../lib/format'
import { flash, leave } from '../lib/motion'
import { toJpeg } from '../lib/files'
import { api, supabase } from '../lib/supabase'

type Provider = 'linkedin' | 'instagram' | 'facebook'
type Kind = 'feed' | 'story'

interface Person { user_id: string; name: string; role: 'owner' | 'publisher'; needs_approval: boolean }
interface Account {
  id: string
  provider: Provider
  name: string
  handle: string | null
  organizations: { urn: string; name: string }[]
  status: 'ok' | 'credentials' | 'error' | 'gone'
  role: 'owner' | 'publisher'
  needs_approval: boolean
  people: Person[]
}
interface Listing { configured: boolean; facebook: boolean; accounts: Account[]; moderators: { id: string; name: string }[] }
interface Media { path: string; mime: string; name: string; size: number; url?: string | null }
interface Target {
  id: string
  provider: Provider
  label: string
  kind: Kind
  status: 'approval' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'rejected'
  due_at: string
  error: string | null
  published_at: string | null
  can_decide: boolean
}
interface Post { id: string; text: string; scheduled_at: string | null; created_at: string; author: string; mine: boolean; media: Media[]; targets: Target[] }

/** Jedno miejsce publikacji: profil, strona firmowa albo relacja. */
interface Place { key: string; account: Account; provider: Provider; kind: Kind; org?: { urn: string; name: string }; title: string; sub: string }

const LIMIT = { instagram: 2200, linkedin: 3000 }
const NETWORK: Record<Provider, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', facebook: 'Facebook' }
const MAX_FILE = 50 * 1024 * 1024
const isVideo = (m: { mime: string }) => m.mime.startsWith('video/')

export const NetIcon = ({ provider, size = 18 }: { provider: Provider; size?: number }) => provider === 'instagram' ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" />
  </svg>
) : provider === 'facebook' ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21h3Z" />
  </svg>
) : (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11H3v-11Zm6.5 0h3.8v1.6h.05c.55-1 1.9-1.9 3.85-1.9 4.1 0 4.8 2.6 4.8 6v5.3h-4v-4.7c0-1.2 0-2.8-1.75-2.8s-2 1.3-2 2.7v4.8h-4v-11Z" />
  </svg>
)

function places(accounts: Account[]): Place[] {
  const out: Place[] = []
  const pages = new Set<string>()
  for (const a of accounts) {
    if (a.provider === 'instagram') {
      out.push({ key: `${a.id}||feed`, account: a, provider: 'instagram', kind: 'feed', title: a.name, sub: 'Instagram · post' })
      out.push({ key: `${a.id}||story`, account: a, provider: 'instagram', kind: 'story', title: a.name, sub: 'Instagram · relacja' })
    } else if (a.provider === 'facebook') {
      out.push({ key: `${a.id}||feed`, account: a, provider: 'facebook', kind: 'feed', title: a.name, sub: 'Facebook · strona' })
    } else {
      out.push({ key: `${a.id}||feed`, account: a, provider: 'linkedin', kind: 'feed', title: a.name, sub: 'LinkedIn · profil osobisty' })
    }
  }
  // strona firmowa dostępna przez kilka osób pojawia się raz
  for (const a of accounts) {
    for (const org of a.provider === 'linkedin' ? a.organizations : []) {
      if (pages.has(org.urn)) continue
      pages.add(org.urn)
      out.push({ key: `${a.id}|${org.urn}|feed`, account: a, provider: 'linkedin', kind: 'feed', org, title: org.name, sub: `LinkedIn · strona firmy (przez: ${a.name})` })
    }
  }
  return out
}

export default function SocialPage() {
  const company = useCompany()
  const { toast, fail } = useFeedback()
  const [params, setParams] = useSearchParams()
  const tab = (['new', 'queue', 'done', 'accounts'].includes(params.get('tab') ?? '') ? params.get('tab') : 'new') as 'new' | 'queue' | 'done' | 'accounts'
  const setTab = (t: string) => setParams(t === 'new' ? {} : { tab: t }, { replace: true })

  const list = useQuery(() => api<Listing>('social_list', { company_id: company.id }).catch((e) => { fail(e); return { configured: false, facebook: false, accounts: [], moderators: [] } as Listing }), [company.id])
  const posts = useQuery(() => api<{ posts: Post[] }>('social_posts', { company_id: company.id }).then((d) => d.posts).catch(() => [] as Post[]), [company.id])
  const reloadList = list.reload
  const reloadPosts = posts.reload

  // powrót ze strony logowania: Unipile zgłasza konto osobnym wywołaniem, więc chwilę dopytujemy
  const back = params.get('social')
  useEffect(() => {
    if (!back) return
    if (back === 'error') toast('Logowanie nie powiodło się. Spróbuj ponownie.', 'error')
    else if (back === 'nopages') toast('Facebook nie przekazał żadnej strony. Podłącz ponownie i w oknie Facebooka wybierz „Zmień ustawienia”, a potem zaznacz strony.', 'error')
    else if (back === 'noperm') toast('Facebook nie przyznał prawa do publikowania. Podłącz ponownie i w oknie Facebooka wybierz „Zmień ustawienia”.', 'error')
    else toast('Konto podłączone')
    setParams({ tab: 'accounts' }, { replace: true })
    if (back !== 'connected') return
    let n = 0
    const timer = setInterval(() => { reloadList(); if (++n >= 6) clearInterval(timer) }, 2500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back])

  // dopóki coś się wysyła — odświeżamy stan
  const live = (posts.data ?? []).some((p) => p.targets.some((t) => t.status === 'publishing' || (t.status === 'scheduled' && new Date(t.due_at).getTime() < Date.now() + 90_000)))
  useEffect(() => {
    if (!live) return
    const timer = setInterval(reloadPosts, 4000)
    return () => clearInterval(timer)
  }, [live, reloadPosts])

  if ((list.loading && !list.data) || (posts.loading && !posts.data)) return <Loading />
  const accounts = list.data!.accounts
  const all = posts.data ?? []
  const done = all.filter((p) => p.targets.length > 0 && p.targets.every((t) => t.status === 'published'))
  const queue = all.filter((p) => !done.includes(p))
  const waiting = queue.filter((p) => p.targets.some((t) => t.status === 'approval' && t.can_decide)).length

  return (
    <Page crumb="Publikacje">
      <div className="page__head">
        <div>
          <h1>Publikacje</h1>
          <p>Jeden post na Instagram, Facebook i LinkedIn naraz — z podglądem, planowaniem i akceptacją.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'new', label: 'Nowy post' },
        { value: 'queue', label: 'W kolejce', count: queue.length || undefined },
        { value: 'done', label: 'Opublikowane' },
        { value: 'accounts', label: 'Konta', count: accounts.length || undefined },
      ]} />

      {tab === 'new' && (accounts.length
        ? <Composer accounts={accounts} onSent={(where) => { reloadPosts(); setTab(where) }} />
        : <Empty icon={<Send size={24} />} title="Najpierw podłącz konto" text="Podłącz Instagram, Facebook lub LinkedIn, a potem publikuj na wszystkie konta jednym kliknięciem."
            action={<Button variant="primary" onClick={() => setTab('accounts')}>Przejdź do kont</Button>} />)}

      {tab === 'queue' && (queue.length
        ? <div className="soc-posts">{waiting > 0 && <p className="soc-note"><Clock size={16} />{waiting} {plural(waiting, ['post czeka', 'posty czekają', 'postów czeka'])} na Twoją akceptację.</p>}{queue.map((p) => <PostCard key={p.id} post={p} reload={reloadPosts} />)}</div>
        : <Empty icon={<CalendarClock size={24} />} title="Kolejka jest pusta" text="Tu pojawią się posty zaplanowane, czekające na akceptację i te, których nie udało się wysłać." />)}

      {tab === 'done' && (done.length
        ? <div className="soc-posts">{done.map((p) => <PostCard key={p.id} post={p} reload={reloadPosts} />)}</div>
        : <Empty icon={<CircleCheck size={24} />} title="Jeszcze nic nie opublikowano" />)}

      {tab === 'accounts' && <Accounts listing={list.data!} reload={reloadList} />}
    </Page>
  )
}

// ───────── nowy post ─────────

function Composer({ accounts, onSent }: { accounts: Account[]; onSent(tab: 'queue' | 'done'): void }) {
  const company = useCompany()
  const { toast, fail } = useFeedback()
  const all = useMemo(() => places(accounts), [accounts])
  const [text, setText] = useState('')
  const [media, setMedia] = useState<Media[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [when, setWhen] = useState('')
  const [planning, setPlanning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [view, setView] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const chosen = all.filter((p) => picked.includes(p.key))
  const views = [
    chosen.find((p) => p.provider === 'instagram' && p.kind === 'feed') && { value: 'instagram', label: 'Instagram' },
    chosen.find((p) => p.kind === 'story') && { value: 'story', label: 'Relacja' },
    chosen.find((p) => p.provider === 'facebook') && { value: 'facebook', label: 'Facebook' },
    chosen.find((p) => p.provider === 'linkedin') && { value: 'linkedin', label: 'LinkedIn' },
  ].filter(Boolean) as { value: string; label: string }[]
  const current = views.find((v) => v.value === view)?.value ?? views[0]?.value
  const shown = chosen.find((p) => (current === 'story' ? p.kind === 'story' : p.provider === current && p.kind === 'feed'))

  const problems: string[] = []
  const hasIg = chosen.some((p) => p.provider === 'instagram')
  const hasLi = chosen.some((p) => p.provider === 'linkedin')
  const hasFb = chosen.some((p) => p.provider === 'facebook')
  if (!text.trim() && !media.length) problems.push('Dodaj tekst albo zdjęcie')
  if (hasIg && !media.length) problems.push('Instagram wymaga zdjęcia lub wideo')
  if (chosen.some((p) => p.kind === 'story') && media.length !== 1) problems.push('Relacja to dokładnie jeden plik')
  if (hasIg && text.length > LIMIT.instagram) problems.push(`Instagram: tekst dłuższy niż ${LIMIT.instagram} znaków`)
  if (hasIg && (text.match(/#[\p{L}\d_]+/gu)?.length ?? 0) > 30) problems.push('Instagram: najwyżej 30 hashtagów')
  if (hasLi && text.length > LIMIT.linkedin) problems.push(`LinkedIn: tekst dłuższy niż ${LIMIT.linkedin} znaków`)
  if (hasLi && media.some(isVideo) && media.length > 1) problems.push('LinkedIn: wideo tylko jako pojedynczy plik')
  if (hasFb && media.some(isVideo) && media.length > 1) problems.push('Facebook: wideo tylko jako pojedynczy plik')
  if (chosen.some((p) => p.account.status !== 'ok')) problems.push('Jedno z kont wymaga ponownego podłączenia')
  const approval = chosen.filter((p) => p.account.needs_approval).length

  const toggle = (key: string) => setPicked((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const original of [...files].slice(0, 10 - media.length)) {
        const file = original.type.startsWith('video/') ? original : await toJpeg(original)
        if (file.size > MAX_FILE) throw new Error(`${original.name}: plik większy niż 50 MB`)
        const path = `${company.id}/${crypto.randomUUID().slice(0, 8)}-${file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80)}`
        const { error } = await supabase.storage.from('social').upload(path, file, { contentType: file.type })
        if (error) throw new Error(error.message)
        setMedia((list) => [...list, { path, mime: file.type, name: file.name, size: file.size, url: URL.createObjectURL(file) }])
      }
    } catch (e) {
      fail(e)
    }
    setUploading(false)
    if (input.current) input.current.value = ''
  }
  const dropMedia = (m: Media) => {
    setMedia((list) => list.filter((x) => x.path !== m.path))
    supabase.storage.from('social').remove([m.path])
  }

  const send = async () => {
    setSending(true)
    try {
      const res = await api<{ approval: number; scheduled: boolean }>('social_publish', {
        company_id: company.id,
        text,
        media: media.map(({ path, mime, name, size }) => ({ path, mime, name, size })),
        targets: chosen.map((p) => ({ account_id: p.account.id, org_urn: p.org?.urn, kind: p.kind })),
        scheduled_at: planning && when ? new Date(when).toISOString() : null,
      })
      toast(res.approval === chosen.length ? 'Wysłano do akceptacji' : res.scheduled ? 'Post zaplanowany' : 'Publikuję…')
      setText('')
      setMedia([])
      setPicked([])
      setWhen('')
      setPlanning(false)
      onSent('queue')
    } catch (e) {
      fail(e)
    }
    setSending(false)
  }

  const minWhen = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000 + 5 * 60_000).toISOString().slice(0, 16)

  return (
    <div className="soc">
      <div className="soc__edit">
        <section className="soc-box">
          <div className="soc-box__head">
            <b>Treść</b>
            <Button size="sm" variant="quiet" icon={<Sparkles size={15} />} onClick={() => setDrafting(true)}>Napisz z bazy</Button>
          </div>
          <textarea className="textarea soc__text" value={text} onChange={(e) => setText(e.target.value)} placeholder="O czym chcesz dziś napisać?" />
          <div className="soc__count">
            {hasIg && <span className={cx(text.length > LIMIT.instagram && 'is-over')}>Instagram {text.length}/{LIMIT.instagram}</span>}
            {hasLi && <span className={cx(text.length > LIMIT.linkedin && 'is-over')}>LinkedIn {text.length}/{LIMIT.linkedin}</span>}
            {!hasIg && !hasLi && <span>{text.length} {plural(text.length, ['znak', 'znaki', 'znaków'])}</span>}
          </div>
          <div className="soc-media">
            {media.map((m) => (
              <div key={m.path} className="soc-media__item">
                {isVideo(m) ? <video src={m.url ?? undefined} muted playsInline /> : <img src={m.url ?? undefined} alt="" />}
                {isVideo(m) && <span className="soc-media__tag"><Film size={13} />wideo</span>}
                <IconBtn label="Usuń" className="soc-media__x" onClick={() => dropMedia(m)}><X size={14} /></IconBtn>
              </div>
            ))}
            {media.length < 10 && (
              <button type="button" className="soc-media__add" onClick={() => input.current?.click()} disabled={uploading}>
                {uploading ? <span className="spinner" style={{ width: 18, height: 18 }} /> : <ImagePlus size={20} />}
                <span>{uploading ? 'Wysyłam…' : 'Zdjęcie lub wideo'}</span>
              </button>
            )}
            <input ref={input} type="file" hidden multiple accept="image/*,video/mp4,video/quicktime" onChange={(e) => addFiles(e.target.files)} />
          </div>
        </section>

        <section className="soc-box">
          <div className="soc-box__head"><b>Gdzie publikujemy</b>{all.length > 1 && <button type="button" className="soc-link" onClick={() => setPicked(picked.length === all.filter((p) => p.kind === 'feed').length ? [] : all.filter((p) => p.kind === 'feed').map((p) => p.key))}>{picked.length ? 'Odznacz' : 'Zaznacz wszystkie'}</button>}</div>
          <div className="soc-places">
            {all.map((p) => (
              <label key={p.key} className={cx('soc-place', picked.includes(p.key) && 'is-on', p.account.status !== 'ok' && 'is-off')}>
                <input type="checkbox" checked={picked.includes(p.key)} disabled={p.account.status !== 'ok'} onChange={() => toggle(p.key)} />
                <span className="soc-place__ico"><NetIcon provider={p.provider} /></span>
                <span className="grow"><b className="truncate">{p.title}</b><small className="truncate">{p.account.status !== 'ok' ? 'Wymaga ponownego podłączenia' : p.sub}</small></span>
                {p.account.needs_approval && <Badge tone="accent">po akceptacji</Badge>}
                <i className="soc-place__check" aria-hidden><Check size={14} /></i>
              </label>
            ))}
          </div>
        </section>

        <section className="soc-box">
          <div className="soc-box__head"><b>Kiedy</b></div>
          <div className="row row--wrap">
            <Segmented value={planning ? 'later' : 'now'} onChange={(v) => setPlanning(v === 'later')} options={[{ value: 'now', label: 'Od razu' }, { value: 'later', label: <><CalendarClock size={15} />Zaplanuj</> }]} />
            {planning && <input type="datetime-local" className="input soc__when" min={minWhen} value={when} onChange={(e) => setWhen(e.target.value)} />}
          </div>
        </section>

        <div className="soc__send">
          <div className="grow">
            {chosen.length === 0
              ? <span className="muted">Wybierz co najmniej jedno konto.</span>
              : problems.length
                ? <span className="soc__problem"><TriangleAlert size={15} />{problems[0]}</span>
                : <span className="muted">{approval > 0 && `${approval} z ${chosen.length} — po akceptacji właściciela. `}{chosen.length} {plural(chosen.length, ['miejsce', 'miejsca', 'miejsc'])}.</span>}
          </div>
          <Button variant="primary" size="lg" icon={<Send size={18} />} busy={sending}
            disabled={!chosen.length || problems.length > 0 || uploading || (planning && !when)} onClick={send}>
            {planning ? 'Zaplanuj' : approval === chosen.length && chosen.length > 0 ? 'Wyślij do akceptacji' : 'Opublikuj'}
          </Button>
        </div>
      </div>

      <aside className="soc__preview">
        <div className="soc-box__head">
          <b>Podgląd</b>
          {views.length > 1 && <Segmented value={current!} onChange={setView} options={views} />}
        </div>
        {shown
          ? current === 'linkedin' || current === 'facebook' ? <LinkedInPreview place={shown} text={text} media={media} />
            : current === 'story' ? <StoryPreview place={shown} media={media} />
              : <InstagramPreview place={shown} text={text} media={media} />
          : <p className="soc-preview__empty">Zaznacz konto, żeby zobaczyć, jak post będzie wyglądał.</p>}
        <p className="soc-preview__hint">Podgląd przybliżony — sieci mogą nieco inaczej przyciąć zdjęcie i tekst.</p>
      </aside>

      <DraftModal open={drafting} onClose={() => setDrafting(false)} onText={(t) => { setText(t); setDrafting(false) }} />
    </div>
  )
}

function DraftModal({ open, onClose, onText }: { open: boolean; onClose(): void; onText(text: string): void }) {
  const company = useCompany()
  const { fail } = useFeedback()
  const [product, setProduct] = useState('')
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const products = useQuery(async () => {
    const { data } = await supabase.from('products').select('id, name').eq('company_id', company.id).neq('status', 'archived').order('name')
    return data ?? []
  }, [company.id])
  const run = async () => {
    setBusy(true)
    try {
      onText((await api<{ text: string }>('social_draft', { company_id: company.id, product_id: product || null, brief })).text)
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  return (
    <Modal open={open} onClose={onClose} title="Napisz z bazy" subtitle="AURORA napisze szkic z faktów o produkcie i tonu marki. Zawsze przeczytaj go przed publikacją."
      footer={<><Button onClick={onClose}>Anuluj</Button><Button variant="primary" busy={busy} disabled={!product && brief.trim().length < 5} icon={<Sparkles size={16} />} onClick={run}>Napisz szkic</Button></>}>
      <div className="form">
        <Field label="Produkt">
          <select className="select" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">Bez produktu</option>
            {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="O czym ma być post" hint="Na przykład: zostały ostatnie miejsca, przypomnienie o terminie, nowa cena.">
          <textarea className="textarea" value={brief} onChange={(e) => setBrief(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

// ───────── podglądy ─────────

/** Tekst ucięty tak, jak robi to sieć, z „więcej” do rozwinięcia. */
function Clamp({ text, limit, more }: { text: string; limit: number; more: string }) {
  const [open, setOpen] = useState(false)
  if (open || text.length <= limit) return <>{text}</>
  return <>{text.slice(0, limit).replace(/\s+\S*$/, '')}… <button type="button" className="soc-more" onClick={() => setOpen(true)}>{more}</button></>
}

function Slides({ media, className }: { media: Media[]; className?: string }) {
  const [i, setI] = useState(0)
  const at = Math.min(i, media.length - 1)
  if (!media.length) return <div className={cx('soc-slides soc-slides--empty', className)}><ImagePlus size={26} /><span>Tu będzie zdjęcie lub wideo</span></div>
  const m = media[at]
  return (
    <div className={cx('soc-slides', className)}>
      {isVideo(m) ? <video key={m.path} src={m.url ?? undefined} muted controls playsInline /> : <img src={m.url ?? undefined} alt="" />}
      {media.length > 1 && (
        <>
          <span className="soc-slides__n">{at + 1}/{media.length}</span>
          <div className="soc-slides__dots">{media.map((x, n) => <button key={x.path} type="button" aria-label={`Zdjęcie ${n + 1}`} className={cx(n === at && 'is-on')} onClick={() => setI(n)} />)}</div>
        </>
      )}
    </div>
  )
}

function InstagramPreview({ place, text, media }: { place: Place; text: string; media: Media[] }) {
  return (
    <div className="pv pv--ig">
      <div className="pv__head"><Avatar name={place.title} size={32} /><b className="truncate">{place.title}</b></div>
      <Slides media={media} />
      <div className="pv__acts"><Heart size={22} /><MessageCircle size={22} /><Send size={22} /><span className="grow" /><Bookmark size={22} /></div>
      {text && <p className="pv__text"><b>{place.title}</b> <Clamp text={text} limit={125} more="więcej" /></p>}
    </div>
  )
}

function StoryPreview({ place, media }: { place: Place; media: Media[] }) {
  return (
    <div className="pv pv--story">
      <Slides media={media.slice(0, 1)} />
      <div className="pv__storyhead"><i /><div className="row"><Avatar name={place.title} size={28} /><b className="truncate">{place.title}</b></div></div>
    </div>
  )
}

/** LinkedIn i Facebook mają ten sam układ posta: tekst nad zdjęciem; różnią się miejscem ucięcia i przyciskami. */
function LinkedInPreview({ place, text, media }: { place: Place; text: string; media: Media[] }) {
  const fb = place.provider === 'facebook'
  return (
    <div className="pv pv--li">
      <div className="pv__head">
        <Avatar name={place.title} size={44} />
        <div className="grow"><b className="truncate">{place.title}</b><small>Teraz · <Globe size={11} /></small></div>
      </div>
      {text && <p className="pv__text"><Clamp text={text} limit={fb ? 480 : 210} more={fb ? 'Wyświetl więcej' : 'zobacz więcej'} /></p>}
      {media.length > 0 && <Slides media={media} />}
      {fb
        ? <div className="pv__acts pv__acts--li"><span><ThumbsUp size={17} />Lubię to!</span><span><MessageCircle size={17} />Komentarz</span><span><Repeat2 size={17} />Udostępnij</span></div>
        : <div className="pv__acts pv__acts--li"><span><ThumbsUp size={17} />Polecam</span><span><MessageCircle size={17} />Komentarz</span><span><Repeat2 size={17} />Udostępnij</span><span><Send size={17} />Wyślij</span></div>}
    </div>
  )
}

// ───────── kolejka i historia ─────────

const STATE: Record<Target['status'], { label: string; tone: 'neutral' | 'accent' | 'dark' | 'ok' }> = {
  approval: { label: 'Czeka na akceptację', tone: 'accent' },
  scheduled: { label: 'Zaplanowany', tone: 'neutral' },
  publishing: { label: 'Publikuję…', tone: 'dark' },
  published: { label: 'Opublikowano', tone: 'ok' },
  failed: { label: 'Błąd', tone: 'accent' },
  rejected: { label: 'Odrzucony', tone: 'neutral' },
}

function PostCard({ post, reload }: { post: Post; reload(): Promise<void> }) {
  const { fail, confirm } = useFeedback()
  const [busy, setBusy] = useState('')
  const act = async (id: string, action: string, body: Record<string, unknown>) => {
    setBusy(id)
    try {
      await api(action, body)
      await reload()
      flash(post.id)
    } catch (e) {
      fail(e)
    }
    setBusy('')
  }
  const remove = async () => {
    const live = post.targets.some((t) => t.status === 'published')
    if (!(await confirm({ title: 'Usunąć post z AURORA?', text: live ? 'To, co już opublikowane, zostanie w sieciach — usuń je tam ręcznie.' : 'Zaplanowana publikacja zostanie anulowana.', action: 'Usuń', danger: true }))) return
    try {
      await api('social_delete_post', { post_id: post.id })
      await leave(post.id)
      reload()
    } catch (e) {
      fail(e)
    }
  }
  const cover = post.media[0]
  return (
    <article className="soc-post" data-id={post.id}>
      {cover && <div className="soc-post__cover">{isVideo(cover) ? <video src={cover.url ?? undefined} muted /> : <img src={cover.url ?? undefined} alt="" />}{post.media.length > 1 && <span>+{post.media.length - 1}</span>}</div>}
      <div className="soc-post__main">
        <p className="soc-post__text">{post.text || <span className="muted">Bez tekstu</span>}</p>
        <small className="muted">{post.author || 'Usunięte konto'} · {fmtWhen(post.created_at)}</small>
        <div className="soc-post__targets">
          {post.targets.map((t) => (
            <div key={t.id} className="soc-target">
              <NetIcon provider={t.provider} size={16} />
              <span className="grow truncate"><b>{t.label}</b>{t.kind === 'story' && ' · relacja'}
                {t.status === 'scheduled' && <small> · {fmtWhen(t.due_at)}</small>}
                {t.status === 'published' && t.published_at && <small> · {fmtWhen(t.published_at)}</small>}
                {t.status === 'failed' && t.error && <small className="soc-target__err"> · {t.error}</small>}
              </span>
              <Badge tone={STATE[t.status].tone}>{STATE[t.status].label}</Badge>
              {t.status === 'approval' && t.can_decide && (
                <>
                  <Button size="sm" variant="primary" busy={busy === t.id} onClick={() => act(t.id, 'social_decide', { target_id: t.id, approve: true })}>Akceptuj</Button>
                  <Button size="sm" variant="quiet" onClick={() => act(t.id, 'social_decide', { target_id: t.id, approve: false })}>Odrzuć</Button>
                </>
              )}
              {t.status === 'failed' && (post.mine || t.can_decide) && <Button size="sm" icon={<RotateCw size={14} />} busy={busy === t.id} onClick={() => act(t.id, 'social_retry', { target_id: t.id })}>Ponów</Button>}
            </div>
          ))}
        </div>
      </div>
      <IconBtn label="Usuń post" onClick={remove}><Trash2 size={17} /></IconBtn>
    </article>
  )
}

// ───────── konta i dostęp ─────────

function Accounts({ listing, reload }: { listing: Listing; reload(): Promise<void> }) {
  const company = useCompany()
  const { profile } = useSession()
  const { members } = usePeople()
  const { fail, confirm, toast } = useFeedback()
  const [busy, setBusy] = useState('')

  const connect = async (provider: Provider, accountId?: string) => {
    setBusy(accountId ?? provider)
    try {
      const { url } = await api<{ url: string }>('social_connect', { company_id: company.id, provider, account_id: accountId, origin: location.origin })
      location.href = url
    } catch (e) {
      fail(e)
      setBusy('')
    }
  }
  const call = useCallback(async (action: string, body: Record<string, unknown>) => {
    try {
      await api(action, { company_id: company.id, ...body })
      await reload()
    } catch (e) {
      fail(e)
    }
  }, [company.id, reload, fail])
  const disconnect = async (a: Account) => {
    const last = a.role === 'owner' && a.people.filter((p) => p.role === 'owner').length === 1
    if (!(await confirm({ title: `Odłączyć „${a.name}”?`, text: last ? 'Osoby, którym dałeś dostęp, też go stracą.' : 'Konto zostanie u pozostałych osób.', action: 'Odłącz', danger: true }))) return
    await call('social_disconnect', { account_id: a.id })
    toast('Konto odłączone')
  }

  // dostęp można dać osobie z tej samej firmy albo moderatorowi
  const candidates = [
    ...members.map((m) => ({ id: m.user_id, name: m.profile?.full_name || m.profile?.email || '' })),
    ...listing.moderators.filter((m) => !members.some((x) => x.user_id === m.id)).map((m) => ({ ...m, name: `${m.name} · moderator` })),
  ].filter((c) => c.id !== profile?.id)

  return (
    <div className="soc-accounts">
      {!listing.configured && <p className="integ__error"><TriangleAlert size={15} />Publikacje nie są jeszcze skonfigurowane po stronie serwera.</p>}
      <div className="soc-connect">
        <ConnectCard provider="instagram" title="Instagram" text="Posty, karuzele, wideo i relacje." busy={busy === 'instagram'} disabled={!listing.configured} onClick={() => connect('instagram')} />
        <ConnectCard provider="facebook" title="Facebook" text={listing.facebook ? 'Strony, którymi zarządzasz.' : 'Czeka na konfigurację aplikacji Meta przez moderatora.'} busy={busy === 'facebook'} disabled={!listing.facebook} onClick={() => connect('facebook')} />
        <ConnectCard provider="linkedin" title="LinkedIn" text="Profil osobisty i strony firmowe, którymi zarządzasz." busy={busy === 'linkedin'} disabled={!listing.configured} onClick={() => connect('linkedin')} />
      </div>
      <p className="soc-preview__hint">Logujesz się na stronie Unipile (Instagram, LinkedIn) albo Facebooka — AURORA nie widzi hasła. Jeśli konto podłączył już ktoś inny, nie powstanie druga kopia: zobaczysz je tutaj razem z tą osobą.</p>
      {profile?.is_moderator && <MetaSetup onSaved={reload} />}

      {listing.accounts.map((a) => {
        const others = a.people.filter((p) => p.role === 'owner' && p.user_id !== profile?.id)
        const guests = a.people.filter((p) => p.role === 'publisher')
        const free = candidates.filter((c) => !a.people.some((p) => p.user_id === c.id))
        return (
          <section key={a.id} className="integ" data-id={a.id}>
            <header className="integ__head">
              <span className={cx('integ__ico', a.provider !== 'instagram' && 'integ__ico--dark')}><NetIcon provider={a.provider} size={22} /></span>
              <div className="grow">
                <h2>{a.name}</h2>
                <p>
                  {a.provider === 'facebook' ? 'Facebook · strona' : `${NETWORK[a.provider]}${a.handle ? ` · ${a.handle}` : ''}`}
                  {a.organizations.length > 0 && ` · strony: ${a.organizations.map((o) => o.name).join(', ')}`}
                </p>
              </div>
              {a.status === 'ok'
                ? <Badge tone="ok" icon={<CircleCheck size={14} />}>Podłączono</Badge>
                : <Badge tone="accent" icon={<TriangleAlert size={14} />}>{a.status === 'gone' ? 'Konto usunięte u dostawcy' : 'Wymaga logowania'}</Badge>}
            </header>

            {others.length > 0 && <p className="soc-also">To konto mają też podłączone: <b>{others.map((p) => p.name).join(', ')}</b></p>}
            {a.role === 'publisher' && <p className="soc-also">Dostęp od właściciela konta: <b>{a.people.filter((p) => p.role === 'owner').map((p) => p.name).join(', ')}</b> · {a.needs_approval ? 'Twoje posty wychodzą po akceptacji' : 'publikujesz samodzielnie'}</p>}

            {a.role === 'owner' && (guests.length > 0 || free.length > 0) && (
              <div className="soc-people">
                {guests.map((p) => (
                  <div key={p.user_id} className="soc-person">
                    <Avatar name={p.name} size={32} />
                    <b className="grow truncate">{p.name}</b>
                    <Segmented value={p.needs_approval ? 'ask' : 'self'} onChange={(v) => call('social_grant', { account_id: a.id, user_id: p.user_id, needs_approval: v === 'ask' })}
                      options={[{ value: 'self', label: 'Publikuje sam' }, { value: 'ask', label: 'Po mojej akceptacji' }]} />
                    <IconBtn label="Zabierz dostęp" onClick={() => call('social_revoke', { account_id: a.id, user_id: p.user_id })}><X size={16} /></IconBtn>
                  </div>
                ))}
                {free.length > 0 && (
                  <Menu align="left" trigger={(_, toggle) => <Button size="sm" icon={<UserPlus size={15} />} onClick={toggle}>Daj dostęp</Button>}>
                    {(close) => free.map((c) => <MenuItem key={c.id} icon={<Plus size={15} />} onClick={() => { close(); call('social_grant', { account_id: a.id, user_id: c.id, needs_approval: true }) }}>{c.name}</MenuItem>)}
                  </Menu>
                )}
              </div>
            )}

            <div className="integ__acts">
              <span className="grow" />
              {a.status !== 'ok' && a.role === 'owner' && <Button size="sm" variant="accent" busy={busy === a.id} onClick={() => connect(a.provider, a.status === 'gone' ? undefined : a.id)}>Zaloguj ponownie</Button>}
              <Button size="sm" variant="quiet" onClick={() => disconnect(a)}>Odłącz</Button>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ConnectCard({ provider, title, text, busy, disabled, onClick }: { provider: Provider; title: string; text: ReactNode; busy: boolean; disabled: boolean; onClick(): void }) {
  return (
    <div className="soc-connect__card">
      <span className={cx('integ__ico', provider !== 'instagram' && 'integ__ico--dark')}><NetIcon provider={provider} size={22} /></span>
      <div className="grow"><b>{title}</b><small>{text}</small></div>
      <Button variant="primary" busy={busy} disabled={disabled} icon={<Plus size={16} />} onClick={onClick}>Podłącz</Button>
    </div>
  )
}

/** Moderator: dane aplikacji Meta, przez którą publikujemy na stronach Facebooka. */
function MetaSetup({ onSaved }: { onSaved(): void }) {
  const { fail, toast } = useFeedback()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ id: '', secret: '', config: '' })
  const cfg = useQuery(() => api<{ meta_app_id: string; meta_secret_set: boolean; meta_config_id: string; meta_redirect_uri: string }>('platform_get').catch(() => null), [])
  useEffect(() => {
    if (cfg.data) setForm((f) => ({ ...f, id: cfg.data!.meta_app_id, config: cfg.data!.meta_config_id }))
  }, [cfg.data])
  if (!cfg.data) return null
  const ready = !!cfg.data.meta_app_id && cfg.data.meta_secret_set
  const save = async () => {
    setBusy(true)
    try {
      await api('platform_set', { meta_app_id: form.id, meta_config_id: form.config, meta_app_secret: form.secret })
      toast('Zapisano')
      setForm((f) => ({ ...f, secret: '' }))
      await cfg.reload()
      onSaved()
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  return (
    <section className="soc-setup">
      <button type="button" className="soc-setup__head" onClick={() => setOpen((v) => !v)}>
        <b>Aplikacja Meta dla Facebooka</b>
        <Badge tone={ready ? 'ok' : 'neutral'}>{ready ? 'Skonfigurowana' : 'Do uzupełnienia'}</Badge>
      </button>
      {open && (
        <div className="form">
          <p className="soc-preview__hint">W aplikacji Meta dodaj adres powrotu do „Valid OAuth Redirect URIs” i utwórz osobną konfigurację logowania dla AURORA z uprawnieniami <b>pages_show_list</b>, <b>pages_manage_posts</b>, <b>pages_read_engagement</b>. AURORA nie podpina webhooków i nie czyta wiadomości.</p>
          <Field label="Adres powrotu (Redirect URI)"><input className="input" readOnly value={cfg.data.meta_redirect_uri} onFocus={(e) => e.target.select()} /></Field>
          <div className="form__row">
            <Field label="App ID"><input className="input" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} /></Field>
            <Field label="ID konfiguracji logowania" hint="Puste = zwykłe logowanie z listą uprawnień."><input className="input" value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} /></Field>
          </div>
          <Field label="App Secret" hint={cfg.data.meta_secret_set ? 'Zapisany. Wpisz nowy tylko, gdy chcesz go zmienić.' : 'Przechowywany zaszyfrowany.'}>
            <input className="input" type="password" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          </Field>
          <div><Button variant="primary" busy={busy} disabled={!form.id.trim() || (!cfg.data.meta_secret_set && !form.secret.trim())} onClick={save}>Zapisz</Button></div>
        </div>
      )}
    </section>
  )
}
