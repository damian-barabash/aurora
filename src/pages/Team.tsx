import { CircleCheck, KeyRound, MoreHorizontal, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Page } from '../app/Shell'
import { CodeLine } from '../app/connect'
import { usePeople } from '../app/people'
import { useCompany, useQuery, useSession } from '../app/session'
import { Avatar, Badge, Button, Field, IconBtn, Menu, MenuItem, Modal, Segmented, useFeedback } from '../components/ui'
import { useT } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'
import type { Member } from '../lib/types'

export default function TeamPage() {
  const t = useT()
  const company = useCompany()
  const { canManage, profile } = useSession()
  const { members, reload } = usePeople()
  const { fail, toast, confirm } = useFeedback()
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ email: '', full_name: '', role: 'member' as 'member' | 'admin' })
  const [busy, setBusy] = useState(false)
  const [creds, setCreds] = useState<{ email: string; password: string | null; existed: boolean } | null>(null)

  const mail = useQuery(async () => {
    const { data } = await supabase.from('integrations').select('user_id, status').eq('company_id', company.id)
    return new Set((data ?? []).filter((i) => i.status === 'active').map((i) => i.user_id))
  }, [company.id])

  if (!canManage) return <Navigate to="/app" replace />

  const add = async () => {
    setBusy(true)
    try {
      const res = await api<{ email: string; password: string | null; existed: boolean }>('create_user', { company_id: company.id, ...f })
      setAdding(false)
      setF({ email: '', full_name: '', role: 'member' })
      setCreds(res)
      reload()
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  const setRole = async (m: Member, role: 'admin' | 'member') => {
    await api('update_member', { company_id: company.id, user_id: m.user_id, role }).catch(fail)
    reload()
  }
  const reset = async (m: Member) => {
    if (!(await confirm({ title: t('Сбросить пароль?', 'Zresetować hasło?'), text: m.profile.email, action: t('Сбросить', 'Zresetuj') }))) return
    try {
      const { password } = await api<{ password: string }>('reset_password', { company_id: company.id, user_id: m.user_id })
      setCreds({ email: m.profile.email, password, existed: false })
    } catch (e) {
      fail(e)
    }
  }
  const remove = async (m: Member) => {
    if (!(await confirm({ title: t('Убрать из фирмы?', 'Usunąć z firmy?'), text: `${m.profile.full_name || m.profile.email} ${t('потеряет доступ к базе знаний этой фирмы.', 'straci dostęp do bazy wiedzy tej firmy.')}`, action: t('Убрать', 'Usuń'), danger: true }))) return
    try {
      await api('remove_member', { company_id: company.id, user_id: m.user_id })
      toast(t('Аккаунт убран', 'Konto usunięte'))
      reload()
    } catch (e) {
      fail(e)
    }
  }

  const connected = members.filter((m) => mail.data?.has(m.user_id)).length

  return (
    <Page className="page--narrow" crumb={t('Команда', 'Zespół')}>
      <div className="page__head">
        <div>
          <h1>{t('Команда', 'Zespół')}</h1>
          <p>{company.name} · {t('почта подключена у', 'poczta podłączona u')} {connected} {t('из', 'z')} {members.length}. {t('Регистрации нет — аккаунты создаёт администратор.', 'Rejestracji nie ma — konta tworzy administrator.')}</p>
        </div>
        <Button variant="accent" size="lg" icon={<UserPlus size={19} />} onClick={() => setAdding(true)}>{t('Добавить человека', 'Dodaj osobę')}</Button>
      </div>

      <div className="team">
        {members.map((m) => (
          <div key={m.user_id} className="team__row">
            <Avatar name={m.profile.full_name || m.profile.email} size={42} />
            <div className="grow team__who">
              <b className="truncate">{m.profile.full_name || m.profile.email}{m.user_id === profile?.id && <span className="muted"> · {t('вы', 'Ty')}</span>}</b>
              <small className="truncate">{m.profile.email}</small>
            </div>
            {mail.data?.has(m.user_id) ? <Badge tone="ok" icon={<CircleCheck size={14} />}>{t('Почта', 'Poczta')}</Badge> : <Badge>{t('Почта не подключена', 'Poczta niepodłączona')}</Badge>}
            <Badge tone={m.profile.is_moderator ? 'dark' : m.role === 'admin' ? 'accent' : 'neutral'}>
              {m.profile.is_moderator ? t('Модератор', 'Moderator') : m.role === 'admin' ? t('Администратор', 'Administrator') : t('Сотрудник', 'Pracownik')}
            </Badge>
            <Menu trigger={(_, toggle) => <IconBtn label={t('Действия', 'Akcje')} onClick={toggle}><MoreHorizontal size={18} /></IconBtn>}>
              {(close) => (
                <>
                  {m.role === 'member'
                    ? <MenuItem icon={<ShieldCheck size={17} />} onClick={() => { close(); setRole(m, 'admin') }}>{t('Сделать администратором', 'Ustaw jako administratora')}</MenuItem>
                    : <MenuItem icon={<UserRound size={17} />} onClick={() => { close(); setRole(m, 'member') }}>{t('Сделать сотрудником', 'Ustaw jako pracownika')}</MenuItem>}
                  <MenuItem icon={<KeyRound size={17} />} onClick={() => { close(); reset(m) }}>{t('Сбросить пароль', 'Zresetuj hasło')}</MenuItem>
                  {m.user_id !== profile?.id && <MenuItem danger icon={<Trash2 size={17} />} onClick={() => { close(); remove(m) }}>{t('Убрать из фирмы', 'Usuń z firmy')}</MenuItem>}
                </>
              )}
            </Menu>
          </div>
        ))}
      </div>

      <div className="roles">
        <div><b>{t('Администратор', 'Administrator')}</b><span>{t('Добавляет людей в свою фирму, решает спорные изменения, настраивает бренд и импорт сайта.', 'Dodaje ludzi do swojej firmy, rozstrzyga sporne zmiany, konfiguruje markę i import strony.')}</span></div>
        <div><b>{t('Сотрудник', 'Pracownik')}</b><span>{t('Читает и дополняет базу, общается с ИИ, подключает свою почту и Claude. Аккаунты не создаёт.', 'Czyta i uzupełnia bazę, rozmawia z AI, podłącza swoją pocztę i Claude. Nie tworzy kont.')}</span></div>
        <div><b>{t('Модератор', 'Moderator')}</b><span>{t('Создаёт фирмы и переключается между ними в меню справа сверху.', 'Tworzy firmy i przełącza się między nimi w menu w prawym górnym rogu.')}</span></div>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('Новый аккаунт', 'Nowe konto')}
        subtitle={`${t('Аккаунт будет привязан к фирме', 'Konto zostanie przypisane do firmy')} «${company.name}».`}
        footer={<><Button onClick={() => setAdding(false)}>{t('Отмена', 'Anuluj')}</Button><Button variant="primary" busy={busy} disabled={!f.email.includes('@')} onClick={add}>{t('Создать', 'Utwórz')}</Button></>}>
        <div className="form">
          <Field label="E-mail"><input className="input" type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="imie@firma.pl" /></Field>
          <Field label={t('Имя и фамилия', 'Imię i nazwisko')}><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label={t('Роль', 'Rola')}>
            <Segmented value={f.role} onChange={(role) => setF({ ...f, role })} options={[{ value: 'member', label: t('Сотрудник', 'Pracownik') }, { value: 'admin', label: t('Администратор', 'Administrator') }]} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!creds} onClose={() => setCreds(null)} width={460} title={creds?.existed ? t('Аккаунт добавлен в фирму', 'Konto dodane do firmy') : t('Данные для входа', 'Dane logowania')}
        subtitle={creds?.existed ? t('У этого человека уже есть аккаунт AURORA — пароль прежний.', 'Ta osoba ma już konto AURORA — hasło pozostaje bez zmian.') : t('Пароль показывается один раз. Передайте его человеку лично.', 'Hasło jest widoczne tylko raz. Przekaż je osobie osobiście.')}
        footer={<Button variant="primary" onClick={() => setCreds(null)}>{t('Готово', 'Gotowe')}</Button>}>
        {creds && !creds.existed && creds.password && (
          <div className="form">
            <Field label="E-mail"><CodeLine text={creds.email} /></Field>
            <Field label={t('Пароль', 'Hasło')}><CodeLine text={creds.password} /></Field>
          </div>
        )}
      </Modal>
    </Page>
  )
}
