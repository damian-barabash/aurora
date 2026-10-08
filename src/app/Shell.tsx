import {
  Bell, BookOpen, Building2, Check, ChevronDown, CircleHelp, Folder, Inbox, LayoutGrid, Library, LogOut, Megaphone, Menu as MenuIcon,
  MessageSquare, PanelLeft, Paperclip, Pin, Plug, Plus, Search, Settings, SlidersHorizontal, Sparkles, Sunrise, Users, ArrowUpRight, Languages,
} from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Mark, Wordmark } from '../brand/Logo'
import { Avatar, Button, cx, Empty, Field, IconBtn, Menu, MenuItem, Modal, useFeedback } from '../components/ui'
import { fmtWhen, useI18n, useT } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'
import type { Chat, Collection, Notification } from '../lib/types'
import { Onboarding } from './Onboarding'
import { useSession } from './session'

// ───────── общие данные панели: чаты, счётчики, сигнал «данные изменились» ─────────

interface PanelCtx {
  chats: Chat[]
  reloadChats(): Promise<void>
  pending: number
  reloadCounts(): Promise<void>
}
const PanelContext = createContext<PanelCtx>(null!)
export const usePanel = () => useContext(PanelContext)

const CHANGED = 'aurora:changed'
export const emitChanged = () => window.dispatchEvent(new Event(CHANGED))
export function useChanged(cb: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED, cb)
    return () => window.removeEventListener(CHANGED, cb)
  }, [cb])
}

export function Shell() {
  const t = useT()
  const { loading, session, profile, company, companies } = useSession()
  const nav = useNavigate()
  const loc = useLocation()
  const [params, setParams] = useSearchParams()
  const { toast } = useFeedback()
  const [chats, setChats] = useState<Chat[]>([])
  const [pending, setPending] = useState(0)
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('aurora_side') === '0')
  const [onboardingStep, setOnboardingStep] = useState<'mail' | 'claude' | null>(null)

  useEffect(() => {
    if (!loading && !session) nav(`/login?next=${encodeURIComponent(loc.pathname)}`, { replace: true })
  }, [loading, session, nav, loc.pathname])

  const reloadChats = useCallback(async () => {
    if (!company || !profile) return
    const { data } = await supabase.from('chats').select('id, title, pinned, updated_at')
      .eq('company_id', company.id).eq('user_id', profile.id).order('updated_at', { ascending: false }).limit(80)
    setChats((data ?? []) as Chat[])
  }, [company, profile])

  const reloadCounts = useCallback(async () => {
    if (!company) return
    const { count } = await supabase.from('proposals').select('id', { count: 'exact', head: true }).eq('company_id', company.id).eq('status', 'pending')
    setPending(count ?? 0)
  }, [company])

  useEffect(() => {
    reloadChats()
    reloadCounts()
  }, [reloadChats, reloadCounts])
  useChanged(reloadCounts)
  useEffect(() => setDrawer(false), [loc.pathname, loc.search])

  // возврат с экрана согласия Google
  useEffect(() => {
    const g = params.get('google')
    if (!g) return
    if (g === 'connected') {
      toast(t('Почта и календарь подключены. Первые письма уже разбираются.', 'Poczta i kalendarz podłączone. Pierwsze wiadomości są już analizowane.'))
      setOnboardingStep('claude')
    } else toast(`${t('Не удалось подключить Google', 'Nie udało się podłączyć Google')}: ${params.get('reason') ?? ''}`, 'error')
    params.delete('google')
    params.delete('reason')
    setParams(params, { replace: true })
    emitChanged()
  }, [params, setParams, toast, t])

  const ctx = useMemo(() => ({ chats, reloadChats, pending, reloadCounts }), [chats, reloadChats, pending, reloadCounts])

  if (loading || !session || !profile) return <div className="boot"><Mark size={34} /></div>

  return (
    <PanelContext.Provider value={ctx}>
      <div className={cx('shell', collapsed && window.innerWidth > 960 && 'shell--collapsed', drawer && 'shell--drawer')}>
        <Sidebar onCollapse={() => {
          localStorage.setItem('aurora_side', collapsed ? '1' : '0')
          setCollapsed(!collapsed)
        }} collapsed={collapsed} />
        <div className="shell__scrim" onClick={() => setDrawer(false)} />
        <main className="shell__main">
          <header className="topbar">
            <IconBtn label={t('Меню', 'Menu')} className="topbar__burger" onClick={() => setDrawer(true)}><MenuIcon size={20} /></IconBtn>
            <div id="crumb" className="topbar__crumb" />
            <div className="topbar__right">
              <Bells />
              <CompanySwitch />
            </div>
          </header>
          <div className="shell__content">
            {company ? <Outlet key={company.id} /> : companies.length === 0 && <NoCompany />}
          </div>
        </main>
      </div>
      {company && <Onboarding step={onboardingStep} setStep={setOnboardingStep} />}
    </PanelContext.Provider>
  )
}

function NoCompany() {
  const t = useT()
  const { profile } = useSession()
  const [open, setOpen] = useState(false)
  return (
    <div className="page">
      <Empty
        icon={<Building2 size={24} />}
        title={profile?.is_moderator ? t('Создайте первую фирму', 'Utwórz pierwszą firmę') : t('Вас ещё не добавили в фирму', 'Nie dodano Cię jeszcze do firmy')}
        text={profile?.is_moderator
          ? t('Фирма — отдельная база знаний со своими продуктами, брендом и командой.', 'Firma to osobna baza wiedzy z własnymi produktami, marką i zespołem.')
          : t('Попросите администратора добавить ваш аккаунт.', 'Poproś administratora o dodanie Twojego konta.')}
        action={profile?.is_moderator && <Button variant="accent" icon={<Plus size={18} />} onClick={() => setOpen(true)}>{t('Создать фирму', 'Utwórz firmę')}</Button>}
      />
      <CreateCompany open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

/** Заголовок страницы: хлебные крошки уходят в верхнюю полосу оболочки. */
export function Page({ crumb, children, className }: { crumb: ReactNode; children: ReactNode; className?: string }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('crumb')), [])
  return (
    <div className={cx('page', className)}>
      {slot && <Crumb slot={slot}>{crumb}</Crumb>}
      {children}
    </div>
  )
}
const Crumb = ({ slot, children }: { slot: HTMLElement; children: ReactNode }) => createPortal(children, slot)

// ───────── боковая панель ─────────

function Sidebar({ collapsed, onCollapse }: { collapsed: boolean; onCollapse(): void }) {
  const t = useT()
  const { lang, setLang } = useI18n()
  const { profile, canManage, role, signOut, patchProfile } = useSession()
  const { chats, pending } = usePanel()
  const loc = useLocation()
  const nav = useNavigate()
  const section = loc.pathname.split('/')[2] ?? ''
  const inChat = section === 'chat'
  const inKb = section === 'kb' || section === 'brand'

  const items = [
    { to: '/app', end: true, icon: <Sunrise size={20} />, label: t('Сегодня', 'Dzisiaj') },
    { to: '/app/chat', icon: <MessageSquare size={20} />, label: t('Чаты', 'Czaty'), count: chats.length || undefined },
    { to: '/app/kb', icon: <Library size={20} />, label: t('База знаний', 'Baza wiedzy'), also: 'brand' },
    { to: '/app/news', icon: <Megaphone size={20} />, label: t('Коммуникаты', 'Komunikaty') },
    { to: '/app/review', icon: <Inbox size={20} />, label: t('Проверка', 'Do sprawdzenia'), count: pending || undefined, hot: pending > 0 },
    { to: '/app/files', icon: <Paperclip size={20} />, label: t('Файлы', 'Pliki') },
  ]
  const manage = [
    { to: '/app/integrations', icon: <Plug size={18} />, label: t('Интеграции', 'Integracje') },
    ...(canManage ? [
      { to: '/app/team', icon: <Users size={18} />, label: t('Команда', 'Zespół') },
      { to: '/app/gaps', icon: <CircleHelp size={18} />, label: t('Пробелы в знаниях', 'Luki w wiedzy') },
    ] : []),
    { to: '/app/settings', icon: <Settings size={18} />, label: t('Настройки', 'Ustawienia') },
  ]
  const roleLabel = role === 'moderator' ? t('Модератор', 'Moderator') : role === 'admin' ? t('Администратор', 'Administrator') : t('Сотрудник', 'Pracownik')

  return (
    <aside className="side">
      <div className="side__top">
        <Link to="/app" className="side__logo" aria-label="AURORA">
          {collapsed ? <Mark size={26} /> : <Wordmark size={24} />}
        </Link>
        <IconBtn label={t('Свернуть меню', 'Zwiń menu')} className="side__collapse" onClick={onCollapse}><PanelLeft size={18} /></IconBtn>
      </div>

      <nav className="side__nav">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} title={it.label}
            className={({ isActive }) => cx('navi', (isActive || (it.also && section === it.also)) && 'is-on')}>
            {it.icon}
            <span className="navi__label">{it.label}</span>
            {it.count !== undefined && <span className={cx('navi__count', it.hot && 'is-hot')}>{it.count}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="side__ctx">
        {inChat ? <ChatList /> : inKb ? <KbNav /> : (
          <>
            <div className="side__label">{t('Управление', 'Zarządzanie')}</div>
            {manage.map((m) => (
              <NavLink key={m.to} to={m.to} title={m.label} className={({ isActive }) => cx('subi', isActive && 'is-on')}>
                {m.icon}<span>{m.label}</span>
              </NavLink>
            ))}
          </>
        )}
      </div>

      <div id="qs-dock" className="side__dock" />

      <Menu up align="left" trigger={(open, toggle) => (
        <button type="button" className={cx('side__me', open && 'is-open')} onClick={toggle}>
          <Avatar name={profile?.full_name || profile?.email || ''} size={40} />
          <span className="side__me-text">
            <b className="truncate">{profile?.full_name || profile?.email}</b>
            <small>{roleLabel}</small>
          </span>
          <SlidersHorizontal size={18} className="side__me-ico" />
        </button>
      )}>
        {(close) => (
          <>
            {(inChat || inKb) && manage.map((m) => (
              <MenuItem key={m.to} icon={m.icon} onClick={() => { close(); nav(m.to) }}>{m.label}</MenuItem>
            ))}
            {(inChat || inKb) && <div className="menu__sep" />}
            <MenuItem icon={<Languages size={18} />} onClick={() => {
              const next = lang === 'ru' ? 'pl' : 'ru'
              setLang(next)
              patchProfile({ locale: next })
            }}>{lang === 'ru' ? 'Polski' : 'Русский'}</MenuItem>
            <MenuItem icon={<LogOut size={18} />} onClick={() => { close(); signOut() }}>{t('Выйти', 'Wyloguj')}</MenuItem>
          </>
        )}
      </Menu>
    </aside>
  )
}

function ChatList() {
  const t = useT()
  const { chats } = usePanel()
  const [q, setQ] = useState('')
  const loc = useLocation()
  const active = loc.pathname.split('/')[3]
  const groups = useMemo(() => {
    const list = q ? chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())) : chats
    const now = Date.now()
    const day = new Date().setHours(0, 0, 0, 0)
    const out: [string, Chat[]][] = [
      [t('Закреплено', 'Przypięte'), list.filter((c) => c.pinned)],
      [t('Сегодня', 'Dzisiaj'), list.filter((c) => !c.pinned && +new Date(c.updated_at) >= day)],
      [t('На этой неделе', 'W tym tygodniu'), list.filter((c) => !c.pinned && +new Date(c.updated_at) < day && now - +new Date(c.updated_at) < 7 * 86400000)],
      [t('Раньше', 'Wcześniej'), list.filter((c) => !c.pinned && now - +new Date(c.updated_at) >= 7 * 86400000)],
    ]
    return out.filter(([, items]) => items.length)
  }, [chats, q, t])
  return (
    <>
      <div className="search side__search">
        <Search size={18} />
        <input className="input" placeholder={t('Поиск по чатам', 'Szukaj w czatach')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Link to="/app/chat" className="btn btn--accent btn--lg side__new">
        <Plus size={20} /><span>{t('Новый чат', 'Nowy czat')}</span><ArrowUpRight size={18} />
      </Link>
      {groups.map(([label, items]) => (
        <div key={label}>
          <div className="side__label">{label}</div>
          {items.map((c) => (
            <Link key={c.id} to={`/app/chat/${c.id}`} className={cx('chati', c.id === active && 'is-on')} title={c.title}>
              <span className="truncate">{c.title || t('Без названия', 'Bez tytułu')}</span>
              {c.pinned && <Pin size={13} />}
            </Link>
          ))}
        </div>
      ))}
    </>
  )
}

function KbNav() {
  const t = useT()
  const { company } = useSession()
  const loc = useLocation()
  const [params] = useSearchParams()
  const [collections, setCollections] = useState<Collection[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const load = useCallback(async () => {
    if (!company) return
    const [{ data: cols }, { data: prods }] = await Promise.all([
      supabase.from('collections').select('*').eq('company_id', company.id).order('position'),
      supabase.from('products').select('collection_id').eq('company_id', company.id).neq('status', 'archived'),
    ])
    setCollections((cols ?? []) as Collection[])
    const map: Record<string, number> = { all: prods?.length ?? 0 }
    for (const p of prods ?? []) if (p.collection_id) map[p.collection_id] = (map[p.collection_id] ?? 0) + 1
    setCounts(map)
  }, [company])
  useEffect(() => { load() }, [load])
  useChanged(load)
  const onList = loc.pathname === '/app/kb'
  const current = params.get('c')
  const icon = (name: string) => name === 'grid' ? <LayoutGrid size={18} /> : name === 'book' ? <BookOpen size={18} /> : <Folder size={18} />
  return (
    <>
      <div className="side__label">{t('Коллекции', 'Kolekcje')}</div>
      <Link to="/app/kb" className={cx('subi', onList && !current && 'is-on is-soft')}>
        <Folder size={18} /><span>{t('Все продукты', 'Wszystkie produkty')}</span><i>{counts.all ?? 0}</i>
      </Link>
      {collections.map((c) => (
        <Link key={c.id} to={`/app/kb?c=${c.id}`} className={cx('subi', onList && current === c.id && 'is-on is-soft')}>
          {icon(c.icon)}<span>{c.name}</span><i>{counts[c.id] ?? 0}</i>
        </Link>
      ))}
      <div className="side__label">{t('О бренде', 'O marce')}</div>
      {[
        ['strategy', <BookOpen size={18} />, t('Стратегия бренда', 'Strategia marki')],
        ['identity', <Sparkles size={18} />, t('Айдентика', 'Identyfikacja')],
        ['tone', <MessageSquare size={18} />, 'Tone of voice'],
      ].map(([key, ico, label]) => (
        <NavLink key={key as string} to={`/app/brand/${key}`} className={({ isActive }) => cx('subi', isActive && 'is-on is-soft')}>
          {ico}<span>{label}</span>
        </NavLink>
      ))}
    </>
  )
}

// ───────── верхняя полоса: фирма и уведомления ─────────

export function CreateCompany({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  const { reload, setCompany } = useSession()
  const { fail, toast } = useFeedback()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const { company } = await api<{ company: { id: string } }>('create_company', { name, website })
      await reload()
      setCompany(company.id)
      toast(t('Фирма создана', 'Firma utworzona'))
      setName('')
      setWebsite('')
      onClose()
      nav('/app')
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  return (
    <Modal open={open} onClose={onClose} title={t('Новая фирма', 'Nowa firma')}
      subtitle={t('У каждой фирмы своя база знаний, бренд и команда.', 'Każda firma ma własną bazę wiedzy, markę i zespół.')}
      footer={<><Button onClick={onClose}>{t('Отмена', 'Anuluj')}</Button><Button variant="primary" busy={busy} disabled={name.trim().length < 2} onClick={submit}>{t('Создать', 'Utwórz')}</Button></>}>
      <div className="form">
        <Field label={t('Название', 'Nazwa')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Fastline Racing Academy" /></Field>
        <Field label={t('Сайт', 'Strona WWW')} hint={t('Необязательно. С сайта можно будет импортировать продукты.', 'Opcjonalnie. Ze strony można będzie zaimportować produkty.')}>
          <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </Field>
      </div>
    </Modal>
  )
}

function CompanySwitch() {
  const t = useT()
  const { company, companies, setCompany, profile } = useSession()
  const [create, setCreate] = useState(false)
  const nav = useNavigate()
  if (!company) return null
  const single = companies.length < 2 && !profile?.is_moderator
  return (
    <>
      <Menu trigger={(open, toggle) => (
        <button type="button" className={cx('cswitch', open && 'is-open')} onClick={single ? undefined : toggle} disabled={single}>
          <Building2 size={17} />
          <span className="truncate">{company.name}</span>
          {!single && <ChevronDown size={16} />}
        </button>
      )}>
        {(close) => (
          <>
            <div className="menu__label">{t('Фирмы', 'Firmy')}</div>
            {companies.map((c) => (
              <MenuItem key={c.id} active={c.id === company.id} icon={c.id === company.id ? <Check size={18} /> : <span style={{ width: 18 }} />}
                onClick={() => { close(); setCompany(c.id); nav('/app') }}>{c.name}</MenuItem>
            ))}
            {profile?.is_moderator && (
              <>
                <div className="menu__sep" />
                <MenuItem icon={<Plus size={18} />} onClick={() => { close(); setCreate(true) }}>{t('Создать фирму', 'Utwórz firmę')}</MenuItem>
              </>
            )}
          </>
        )}
      </Menu>
      <CreateCompany open={create} onClose={() => setCreate(false)} />
    </>
  )
}

function Bells() {
  const t = useT()
  const { lang } = useI18n()
  const { company, profile } = useSession()
  const nav = useNavigate()
  const [items, setItems] = useState<Notification[]>([])
  const load = useCallback(async () => {
    if (!company || !profile) return
    const { data } = await supabase.from('notifications').select('*').eq('company_id', company.id).eq('user_id', profile.id)
      .order('created_at', { ascending: false }).limit(20)
    setItems((data ?? []) as Notification[])
  }, [company, profile])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])
  const unread = items.filter((n) => !n.read_at).length
  const markRead = async () => {
    if (!unread || !profile) return
    setItems((list) => list.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile.id).is('read_at', null)
  }
  if (!company) return null
  return (
    <Menu trigger={(open, toggle) => (
      <IconBtn label={t('Уведомления', 'Powiadomienia')} className={cx('bell', open && 'is-open')} onClick={() => { toggle(); if (open) markRead() }}>
        <Bell size={19} />
        {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
      </IconBtn>
    )}>
      {(close) => (
        <div className="notifs">
          <div className="menu__label">{t('Уведомления', 'Powiadomienia')}</div>
          {!items.length && <p className="notifs__empty">{t('Пока тихо. Подпишитесь на продукты, чтобы узнавать об изменениях.', 'Na razie cicho. Obserwuj produkty, aby wiedzieć o zmianach.')}</p>}
          {items.map((n) => (
            <button key={n.id} type="button" className={cx('notif', !n.read_at && 'is-new')} onClick={() => { close(); markRead(); if (n.link) nav(n.link) }}>
              <b>{n.title}</b>
              {n.body && <span>{n.body}</span>}
              <small>{fmtWhen(n.created_at, lang)}</small>
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}

