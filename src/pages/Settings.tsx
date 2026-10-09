import { Building2, Plug, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreateCompany, Page } from '../app/Shell'
import { useCompany, useSession } from '../app/session'
import { Badge, Button, Field, IconBtn, Toggle, useFeedback } from '../components/ui'
import { api, supabase } from '../lib/supabase'
import { AccessMatrix } from './Access'

export default function SettingsPage() {
  const company = useCompany()
  const { profile, patchProfile, canManage, companies, reload, setCompany } = useSession()
  const { fail, toast, confirm } = useFeedback()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [password, setPassword] = useState('')
  const [c, setC] = useState({ name: company.name, description: company.description, website: company.website ?? '' })
  const [settings, setSettings] = useState(company.settings)
  const [create, setCreate] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    setC({ name: company.name, description: company.description, website: company.website ?? '' })
    setSettings(company.settings)
  }, [company])

  const saveProfile = async () => {
    setBusy('profile')
    await patchProfile({ full_name: name.trim() })
    if (password) {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setBusy('')
        return fail(error.message)
      }
      setPassword('')
    }
    setBusy('')
    toast('Profil zapisany')
  }
  const saveCompany = async (next = settings) => {
    setBusy('company')
    const { error } = await supabase.from('companies').update({ name: c.name.trim(), description: c.description, website: c.website || null, settings: next }).eq('id', company.id)
    setBusy('')
    if (error) return fail(error.message)
    await reload()
    toast('Zapisano')
  }
  const patchSettings = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveCompany(next)
  }
  const removeCompany = async (id: string, title: string) => {
    if (!(await confirm({ title: `${'Usunąć firmę'} «${title}»?`, text: 'Razem z nią zostaną usunięte produkty, wpisy, pliki, czaty i połączenia. Nie można tego cofnąć.', action: 'Usuń na zawsze', danger: true }))) return
    try {
      await api('delete_company', { company_id: id })
      await reload()
      toast('Firma usunięta')
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Page className="page--narrow" crumb="Ustawienia">
      <div className="page__head"><h1>Ustawienia</h1></div>

      <section className="card settings">
        <h2 className="card__title">Twój profil</h2>
        <div className="form">
          <div className="form__row">
            <Field label="Imię i nazwisko"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="E-mail"><input className="input" value={profile?.email ?? ''} readOnly /></Field>
          </div>
          <div className="form__row">
            <Field label="Nowe hasło" hint="Zostaw puste, aby nie zmieniać. Minimum 8 znaków.">
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <div><Button variant="primary" busy={busy === 'profile'} disabled={!!password && password.length < 8} onClick={saveProfile}>Zapisz</Button></div>
        </div>
      </section>

      <section className="card settings">
        <h2 className="card__title">Połączenia</h2>
        <p className="muted">Poczta, kalendarz i Claude są zawsze dostępne w sekcji „Integracje” — nawet gdy plakietka „Szybki start” zniknie.</p>
        <div className="row row--wrap">
          <Link to="/app/integrations" className="btn btn--ghost"><Plug size={17} /><span>Otwórz integracje</span></Link>
          <Button variant="quiet" icon={<Sparkles size={17} />} onClick={async () => { await patchProfile({ onboarding: {} }); location.assign('/app') }}>Pokaż „Szybki start” ponownie</Button>
        </div>
      </section>

      {canManage && (
        <section className="card settings">
          <h2 className="card__title">Firma · {company.name}</h2>
          <div className="form">
            <div className="form__row">
              <Field label="Nazwa"><input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
              <Field label="Strona WWW"><input className="input" value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} placeholder="https://" /></Field>
            </div>
            <Field label="O firmie" hint="Kilka zdań — AI używa ich jako kontekstu.">
              <textarea className="textarea" rows={3} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} />
            </Field>
            <div><Button variant="primary" busy={busy === 'company'} disabled={c.name.trim().length < 2} onClick={() => saveCompany()}>Zapisz</Button></div>
            <hr className="settings__hr" />
            <Toggle checked={settings.auto_apply !== false} onChange={(v) => patchSettings({ auto_apply: v })}
              label="Potwierdzone zmiany stosuj od razu"
              hint="Po wyłączeniu wszystko znalezione w poczcie, kalendarzu i na stronie trafi najpierw do „Sprawdzenia”." />
            <div className="form__row">
              <Field label="Proś o sprawdzenie, gdy produkt nie był aktualizowany">
                <select className="select" value={String(settings.stale_days ?? 120)} onChange={(e) => patchSettings({ stale_days: Number(e.target.value) })}>
                  {[30, 60, 90, 120, 180, 365].map((d) => <option key={d} value={d}>{d} dni</option>)}
                </select>
              </Field>
            </div>
          </div>
        </section>
      )}

      {profile?.is_moderator && (
        <section className="card settings">
          <div className="row row--between">
            <h2 className="card__title">Wszystkie firmy</h2>
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setCreate(true)}>Utwórz firmę</Button>
          </div>
          <div className="tokens">
            {companies.map((x) => (
              <div key={x.id} className="tokens__row">
                <Building2 size={17} />
                <b className="truncate">{x.name}</b>
                <span className="muted grow truncate">{x.website?.replace(/^https?:\/\//, '')}</span>
                {x.id === company.id ? <Badge tone="dark">Otwarta</Badge> : <Button size="sm" variant="quiet" onClick={() => setCompany(x.id)}>Przejdź</Button>}
                <IconBtn label="Usuń" onClick={() => removeCompany(x.id, x.name)}><Trash2 size={16} /></IconBtn>
              </div>
            ))}
          </div>
          <CreateCompany open={create} onClose={() => setCreate(false)} />
        </section>
      )}

      {profile?.is_moderator && (
        <section className="card settings">
          <h2 className="card__title">Konta i dostęp do firm</h2>
          <p className="muted">Administrator i pracownik widzą tylko firmy, do których ich przypiszesz. Dostęp do wszystkich firm ma wyłącznie moderator.</p>
          <AccessMatrix />
        </section>
      )}
    </Page>
  )
}
