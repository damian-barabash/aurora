import { Building2, Plug, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreateCompany, Page } from '../app/Shell'
import { useCompany, useSession } from '../app/session'
import { Badge, Button, Field, IconBtn, Segmented, Toggle, useFeedback } from '../components/ui'
import { useI18n, useT, type Lang } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'

export default function SettingsPage() {
  const t = useT()
  const { lang, setLang } = useI18n()
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
    toast(t('Профиль сохранён', 'Profil zapisany'))
  }
  const saveCompany = async (next = settings) => {
    setBusy('company')
    const { error } = await supabase.from('companies').update({ name: c.name.trim(), description: c.description, website: c.website || null, settings: next }).eq('id', company.id)
    setBusy('')
    if (error) return fail(error.message)
    await reload()
    toast(t('Сохранено', 'Zapisano'))
  }
  const patchSettings = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveCompany(next)
  }
  const removeCompany = async (id: string, title: string) => {
    if (!(await confirm({ title: `${t('Удалить фирму', 'Usunąć firmę')} «${title}»?`, text: t('Вместе с ней удалятся продукты, записи, файлы, чаты и подключения. Отменить нельзя.', 'Razem z nią zostaną usunięte produkty, wpisy, pliki, czaty i połączenia. Nie można tego cofnąć.'), action: t('Удалить навсегда', 'Usuń na zawsze'), danger: true }))) return
    try {
      await api('delete_company', { company_id: id })
      await reload()
      toast(t('Фирма удалена', 'Firma usunięta'))
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Page className="page--narrow" crumb={t('Настройки', 'Ustawienia')}>
      <div className="page__head"><h1>{t('Настройки', 'Ustawienia')}</h1></div>

      <section className="card settings">
        <h2 className="card__title">{t('Ваш профиль', 'Twój profil')}</h2>
        <div className="form">
          <div className="form__row">
            <Field label={t('Имя и фамилия', 'Imię i nazwisko')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="E-mail"><input className="input" value={profile?.email ?? ''} readOnly /></Field>
          </div>
          <div className="form__row">
            <Field label={t('Новый пароль', 'Nowe hasło')} hint={t('Оставьте пустым, чтобы не менять. Минимум 8 знаков.', 'Zostaw puste, aby nie zmieniać. Minimum 8 znaków.')}>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={t('Язык интерфейса', 'Język interfejsu')}>
              <Segmented<Lang> value={lang} onChange={(l) => { setLang(l); patchProfile({ locale: l }) }} options={[{ value: 'ru', label: 'Русский' }, { value: 'pl', label: 'Polski' }]} />
            </Field>
          </div>
          <div><Button variant="primary" busy={busy === 'profile'} disabled={!!password && password.length < 8} onClick={saveProfile}>{t('Сохранить', 'Zapisz')}</Button></div>
        </div>
      </section>

      <section className="card settings">
        <h2 className="card__title">{t('Подключения', 'Połączenia')}</h2>
        <p className="muted">{t('Почта, календарь и Claude всегда доступны в разделе «Интеграции» — даже когда плашка «Быстрый старт» исчезнет.', 'Poczta, kalendarz i Claude są zawsze dostępne w sekcji „Integracje” — nawet gdy plakietka „Szybki start” zniknie.')}</p>
        <div className="row row--wrap">
          <Link to="/app/integrations" className="btn btn--ghost"><Plug size={17} /><span>{t('Открыть интеграции', 'Otwórz integracje')}</span></Link>
          <Button variant="quiet" icon={<Sparkles size={17} />} onClick={async () => { await patchProfile({ onboarding: {} }); location.assign('/app') }}>{t('Показать «Быстрый старт» заново', 'Pokaż „Szybki start” ponownie')}</Button>
        </div>
      </section>

      {canManage && (
        <section className="card settings">
          <h2 className="card__title">{t('Фирма', 'Firma')} · {company.name}</h2>
          <div className="form">
            <div className="form__row">
              <Field label={t('Название', 'Nazwa')}><input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
              <Field label={t('Сайт', 'Strona WWW')}><input className="input" value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} placeholder="https://" /></Field>
            </div>
            <Field label={t('О фирме', 'O firmie')} hint={t('Пара фраз — ИИ использует их как контекст.', 'Kilka zdań — AI używa ich jako kontekstu.')}>
              <textarea className="textarea" rows={3} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} />
            </Field>
            <div><Button variant="primary" busy={busy === 'company'} disabled={c.name.trim().length < 2} onClick={() => saveCompany()}>{t('Сохранить', 'Zapisz')}</Button></div>
            <hr className="settings__hr" />
            <Toggle checked={settings.auto_apply !== false} onChange={(v) => patchSettings({ auto_apply: v })}
              label={t('Подтверждённые изменения применять сразу', 'Potwierdzone zmiany stosuj od razu')}
              hint={t('Если выключить, всё найденное в почте, календаре и на сайте сначала попадёт в «Проверку».', 'Po wyłączeniu wszystko znalezione w poczcie, kalendarzu i na stronie trafi najpierw do „Sprawdzenia”.')} />
            <div className="form__row">
              <Field label={t('Просить проверку, если продукт не обновляли', 'Proś o sprawdzenie, gdy produkt nie był aktualizowany')}>
                <select className="select" value={String(settings.stale_days ?? 120)} onChange={(e) => patchSettings({ stale_days: Number(e.target.value) })}>
                  {[30, 60, 90, 120, 180, 365].map((d) => <option key={d} value={d}>{d} {t('дней', 'dni')}</option>)}
                </select>
              </Field>
              <Field label={t('Язык дайджеста', 'Język podsumowania')}>
                <select className="select" value={settings.language ?? 'ru'} onChange={(e) => patchSettings({ language: e.target.value })}>
                  <option value="ru">Русский</option><option value="pl">Polski</option><option value="en">English</option>
                </select>
              </Field>
            </div>
          </div>
        </section>
      )}

      {profile?.is_moderator && (
        <section className="card settings">
          <div className="row row--between">
            <h2 className="card__title">{t('Все фирмы', 'Wszystkie firmy')}</h2>
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setCreate(true)}>{t('Создать фирму', 'Utwórz firmę')}</Button>
          </div>
          <div className="tokens">
            {companies.map((x) => (
              <div key={x.id} className="tokens__row">
                <Building2 size={17} />
                <b className="truncate">{x.name}</b>
                <span className="muted grow truncate">{x.website?.replace(/^https?:\/\//, '')}</span>
                {x.id === company.id ? <Badge tone="dark">{t('Открыта', 'Otwarta')}</Badge> : <Button size="sm" variant="quiet" onClick={() => setCompany(x.id)}>{t('Перейти', 'Przejdź')}</Button>}
                <IconBtn label={t('Удалить', 'Usuń')} onClick={() => removeCompany(x.id, x.name)}><Trash2 size={16} /></IconBtn>
              </div>
            ))}
          </div>
          <CreateCompany open={create} onClose={() => setCreate(false)} />
        </section>
      )}
    </Page>
  )
}
