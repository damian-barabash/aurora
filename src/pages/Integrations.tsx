import { Bot, Calendar, ChevronDown, CircleCheck, Globe, Mail, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Page, useChanged } from '../app/Shell'
import { ClaudeSetup, CodeLine, useConnections, useGoogleConnect } from '../app/connect'
import { GoogleG } from '../app/Onboarding'
import { useCompany, useQuery, useSession } from '../app/session'
import { Badge, Button, cx, Field, IconBtn, Spinner, useFeedback } from '../components/ui'
import { fmtWhen } from '../lib/format'
import { leave } from '../lib/motion'
import { api, supabase } from '../lib/supabase'

interface WebSource {
  id: string
  url: string
  status: 'queued' | 'crawling' | 'ready' | 'error'
  queue: string[]
  stats: { pages?: number; facts?: number; proposed?: number }
  last_error: string | null
  last_crawled_at: string | null
}

export default function IntegrationsPage() {
  const company = useCompany()
  const { profile, canManage } = useSession()
  const { google, tokens, configured, ready, reload } = useConnections()
  const { connect, busy } = useGoogleConnect()
  const { fail, toast, confirm } = useFeedback()
  const [syncing, setSyncing] = useState(false)
  const [url, setUrl] = useState(company.website ?? '')
  const [adding, setAdding] = useState(false)

  const sites = useQuery(async () => {
    const { data } = await supabase.from('web_sources').select('*').eq('company_id', company.id).order('created_at')
    return (data ?? []) as WebSource[]
  }, [company.id])
  const reloadSites = sites.reload
  useChanged(useCallback(() => { reloadSites() }, [reloadSites]))
  // пока сайт читается — обновляем прогресс
  const crawling = (sites.data ?? []).some((s) => s.status === 'queued' || s.status === 'crawling')
  useEffect(() => {
    if (!crawling) return
    const timer = setInterval(reloadSites, 8000)
    return () => clearInterval(timer)
  }, [crawling, reloadSites])

  useEffect(() => {
    if (location.hash === '#site') document.getElementById('site')?.scrollIntoView({ block: 'start' })
  }, [])

  const syncNow = async () => {
    setSyncing(true)
    try {
      await api('sync_now', { company_id: company.id })
      toast('Sprawdzam nowe wiadomości. Wynik pojawi się za minutę.')
      setTimeout(reload, 45_000)
    } catch (e) {
      fail(e)
    }
    setSyncing(false)
  }
  const disconnect = async () => {
    if (!(await confirm({ title: 'Odłączyć pocztę i kalendarz?', text: 'AURORA przestanie czytać nowe wiadomości. Dodane już fakty zostaną w bazie.', action: 'Odłącz', danger: true }))) return
    await api('google_disconnect', { company_id: company.id }).catch(fail)
    reload()
  }
  const addSite = async () => {
    setAdding(true)
    try {
      await api('import_site', { company_id: company.id, url })
      toast('Czytam stronę. Produkty i fakty pojawią się w bazie w ciągu kilku minut.')
      sites.reload()
    } catch (e) {
      fail(e)
    }
    setAdding(false)
  }
  const removeSite = async (id: string) => {
    await api('remove_site', { company_id: company.id, id }).catch(fail)
    await leave(id)
    sites.reload()
  }

  const connected = !!google && google.status !== 'revoked'

  return (
    <Page className="page--narrow" crumb="Integracje">
      <div className="page__head">
        <div>
          <h1>Integracje</h1>
          <p>Źródła, z których AURORA sama zbiera wiedzę o produktach. Do wspólnej bazy trafiają tylko fakty o firmie — nie korespondencja.</p>
        </div>
      </div>

      <section className="integ">
        <header className="integ__head">
          <span className="integ__ico"><Mail size={22} /></span>
          <div className="grow">
            <h2>Gmail + Google Calendar</h2>
            <p>Potwierdzone zmiany z wiadomości i terminy z kalendarza — od razu do bazy wiedzy.</p>
          </div>
          {!ready ? <Spinner /> : connected
            ? <Badge tone={google!.status === 'active' ? 'ok' : 'accent'} icon={google!.status === 'active' ? <CircleCheck size={14} /> : <TriangleAlert size={14} />}>{google!.status === 'active' ? 'Podłączono' : 'Błąd'}</Badge>
            : <Badge>Nie podłączono</Badge>}
        </header>

        {connected ? (
          <>
            <div className="integ__stats">
              <div><small>Konto</small><b className="truncate">{google!.account_email ?? profile?.email}</b></div>
              <div><small>Przeczytanych wiadomości</small><b>{google!.stats.mails ?? 0}</b></div>
              <div><small>Faktów do bazy</small><b>{google!.stats.facts ?? 0}</b></div>
              <div><small>Do sprawdzenia</small><b>{google!.stats.proposed ?? 0}</b></div>
            </div>
            {google!.last_error && <p className="integ__error"><TriangleAlert size={15} />{google!.status === 'revoked' ? 'Dostęp cofnięty — podłącz ponownie.' : google!.last_error}</p>}
            <div className="integ__acts">
              <span className="muted grow">{google!.last_sync_at ? `${'Ostatnie sprawdzenie'}: ${fmtWhen(google!.last_sync_at).toLowerCase()} · ${'co 5 minut'}` : 'Trwa pierwsze sprawdzenie'}</span>
              <Button size="sm" icon={<RefreshCw size={15} />} busy={syncing} onClick={syncNow}>Sprawdź teraz</Button>
              <Button size="sm" variant="quiet" onClick={disconnect}>Odłącz</Button>
            </div>
          </>
        ) : (
          <>
            <ul className="integ__facts">
              <li><Mail size={16} />Tylko odczyt. Wiadomości nie są przechowywane: do bazy trafia tylko neutralnie opisany fakt o produkcie.</li>
              <li><Calendar size={16} />Z kalendarza brane są wydarzenia produktów: premiery, szkolenia, terminy. Prywatne spotkania są pomijane.</li>
            </ul>
            <div className="integ__acts">
              {configured
                ? <Button variant="accent" busy={busy} icon={<GoogleG />} onClick={connect}>Podłącz Google — 1 klik</Button>
                : <span className="integ__error"><TriangleAlert size={15} />{profile?.is_moderator ? 'Najpierw wklej Client ID i Secret poniżej.' : 'Moderator platformy nie zakończył jeszcze konfiguracji Google.'}</span>}
            </div>
          </>
        )}
        {profile?.is_moderator && ready && <GoogleSetup configured={configured} onSaved={reload} />}
      </section>

      <section className="integ">
        <header className="integ__head">
          <span className="integ__ico integ__ico--dark"><Bot size={22} /></span>
          <div className="grow">
            <h2>Claude · MCP</h2>
            <p>Claude odpowiada na podstawie Twojej bazy wiedzy i proponuje jej aktualizację, gdy dowie się czegoś nowego. Działa w claude.ai, Claude Desktop i Claude Code.</p>
          </div>
          {tokens.length > 0 ? <Badge tone="ok" icon={<CircleCheck size={14} />}>Podłączono</Badge> : <Badge>Nie podłączono</Badge>}
        </header>
        <ClaudeSetup tokens={tokens} onChange={reload} />
      </section>

      <section className="integ" id="site">
        <header className="integ__head">
          <span className="integ__ico"><Globe size={22} /></span>
          <div className="grow">
            <h2>Strona firmy</h2>
            <p>AI czyta strony witryny, samo zakłada produkty i fakty, a potem raz na dobę sprawdza, co się zmieniło.</p>
          </div>
        </header>
        {canManage && (
          <div className="integ__site">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://twoja-firma.pl" onKeyDown={(e) => e.key === 'Enter' && url.trim() && addSite()} />
            <Button variant="primary" busy={adding} disabled={!url.trim()} onClick={addSite}>Importuj</Button>
          </div>
        )}
        {(sites.data ?? []).length > 0 && (
          <div className="tokens">
            {sites.data!.map((s) => (
              <div key={s.id} data-id={s.id} className="tokens__row">
                {s.status === 'ready' ? <CircleCheck size={16} /> : s.status === 'error' ? <TriangleAlert size={16} /> : <Spinner size={14} />}
                <b className="truncate">{s.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</b>
                <span className="muted grow truncate">
                  {s.status === 'error' ? s.last_error
                    : `${s.stats.pages ?? 0} ${'str.'} · ${s.stats.facts ?? 0} ${'faktów'}` +
                      (s.queue?.length ? ` · ${'w kolejce'} ${s.queue.length}` : s.last_crawled_at ? ` · ${fmtWhen(s.last_crawled_at).toLowerCase()}` : '')}
                </span>
                {canManage && <IconBtn label="Usuń" onClick={() => removeSite(s.id)}><Trash2 size={16} /></IconBtn>}
              </div>
            ))}
          </div>
        )}
      </section>
    </Page>
  )
}

/** Настройка OAuth-клиента Google — один раз для всей платформы, видит только модератор. */
function GoogleSetup({ configured, onSaved }: { configured: boolean; onSaved(): void }) {
  const { fail, toast } = useFeedback()
  const [open, setOpen] = useState(!configured)
  const [info, setInfo] = useState<{ google_client_id: string; google_secret_set: boolean; redirect_uri: string } | null>(null)
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<{ google_client_id: string; google_secret_set: boolean; redirect_uri: string }>('platform_get').then((d) => {
      setInfo(d)
      setId(d.google_client_id)
    }).catch(() => {})
  }, [])
  const save = async () => {
    setBusy(true)
    try {
      await api('platform_set', { google_client_id: id, google_client_secret: secret })
      toast('Google skonfigurowany. Przycisk podłączenia jest dostępny dla wszystkich pracowników.')
      setSecret('')
      setOpen(false)
      onSaved()
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  return (
    <div className={cx('gsetup', open && 'is-open')}>
      <button type="button" className="gsetup__toggle" onClick={() => setOpen(!open)}>
        <span>Konfiguracja Google OAuth · tylko moderator</span>
        {configured && <Badge tone="ok">Skonfigurowano</Badge>}
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="gsetup__body">
          <ol className="steps">
            <li><b>Utwórz projekt</b><span>Otwórz <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">console.cloud.google.com</a> na koncie administratora Google Workspace i utwórz projekt „AURORA”.</span></li>
            <li><b>Włącz dwa API</b><span>APIs &amp; Services → Library → <b>Gmail API</b> i <b>Google Calendar API</b> → Enable.</span></li>
            <li><b>Ekran zgody</b><span>Google Auth Platform → Branding: nazwa AURORA. Audience: <b>Internal</b> — dostęp tylko dla pracowników Twojej domeny, weryfikacja Google nie jest potrzebna.</span></li>
            <li><b>Uprawnienia</b><span>Data Access → Add scopes: <code>gmail.readonly</code> i <code>calendar.readonly</code>.</span></li>
            <li>
              <b>Utwórz klienta</b>
              <span>Clients → Create client → <b>Web application</b>. W „Authorized redirect URIs” wklej:</span>
              {info && <CodeLine text={info.redirect_uri} />}
            </li>
            <li><b>Wklej klucze tutaj</b><span>Secret jest przechowywany w postaci zaszyfrowanej i nie jest już wyświetlany.</span></li>
          </ol>
          <div className="form">
            <Field label="Client ID"><input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="…apps.googleusercontent.com" /></Field>
            <Field label="Client Secret" hint={info?.google_secret_set ? 'Już zapisany. Zostaw puste, aby nie zmieniać.' : undefined}>
              <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={info?.google_secret_set ? '••••••••••••' : 'GOCSPX-…'} autoComplete="off" />
            </Field>
            <div><Button variant="primary" busy={busy} disabled={!id.trim() || (!secret.trim() && !info?.google_secret_set)} onClick={save}>Zapisz</Button></div>
          </div>
          <p className="muted gsetup__note">Typ Internal działa dla poczty Twojej domeny Workspace. Aby podłączać firmy z innymi domenami, aplikację przełącza się na External i przechodzi weryfikację Google.</p>
        </div>
      )}
    </div>
  )
}
