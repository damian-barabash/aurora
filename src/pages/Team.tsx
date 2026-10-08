import { CircleCheck, KeyRound, MoreHorizontal, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Page } from '../app/Shell'
import { CodeLine } from '../app/connect'
import { usePeople } from '../app/people'
import { useCompany, useQuery, useSession } from '../app/session'
import { Avatar, Badge, Button, Field, IconBtn, Menu, MenuItem, Modal, Segmented, useFeedback } from '../components/ui'
import { leave } from '../lib/motion'
import { api, supabase } from '../lib/supabase'
import type { Member } from '../lib/types'

export default function TeamPage() {
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
    if (!(await confirm({ title: 'Zresetować hasło?', text: m.profile.email, action: 'Zresetuj' }))) return
    try {
      const { password } = await api<{ password: string }>('reset_password', { company_id: company.id, user_id: m.user_id })
      setCreds({ email: m.profile.email, password, existed: false })
    } catch (e) {
      fail(e)
    }
  }
  const remove = async (m: Member) => {
    if (!(await confirm({ title: 'Usunąć z firmy?', text: `${m.profile.full_name || m.profile.email} ${'straci dostęp do bazy wiedzy tej firmy.'}`, action: 'Usuń', danger: true }))) return
    try {
      await api('remove_member', { company_id: company.id, user_id: m.user_id })
      await leave(m.user_id)
      toast('Konto usunięte')
      reload()
    } catch (e) {
      fail(e)
    }
  }

  const connected = members.filter((m) => mail.data?.has(m.user_id)).length

  return (
    <Page className="page--narrow" crumb="Zespół">
      <div className="page__head">
        <div>
          <h1>Zespół</h1>
          <p>{company.name} · poczta podłączona u {connected} z {members.length}. Rejestracji nie ma — konta tworzy administrator.</p>
        </div>
        <Button variant="accent" size="lg" icon={<UserPlus size={19} />} onClick={() => setAdding(true)}>Dodaj osobę</Button>
      </div>

      <div className="team">
        {members.map((m) => (
          <div key={m.user_id} data-id={m.user_id} className="team__row">
            <Avatar name={m.profile.full_name || m.profile.email} size={42} />
            <div className="grow team__who">
              <b className="truncate">{m.profile.full_name || m.profile.email}{m.user_id === profile?.id && <span className="muted"> · Ty</span>}</b>
              <small className="truncate">{m.profile.email}</small>
            </div>
            {mail.data?.has(m.user_id) ? <Badge tone="ok" icon={<CircleCheck size={14} />}>Poczta</Badge> : <Badge>Poczta niepodłączona</Badge>}
            <Badge tone={m.profile.is_moderator ? 'dark' : m.role === 'admin' ? 'accent' : 'neutral'}>
              {m.profile.is_moderator ? 'Moderator' : m.role === 'admin' ? 'Administrator' : 'Pracownik'}
            </Badge>
            <Menu trigger={(_, toggle) => <IconBtn label="Akcje" onClick={toggle}><MoreHorizontal size={18} /></IconBtn>}>
              {(close) => (
                <>
                  {m.role === 'member'
                    ? <MenuItem icon={<ShieldCheck size={17} />} onClick={() => { close(); setRole(m, 'admin') }}>Ustaw jako administratora</MenuItem>
                    : <MenuItem icon={<UserRound size={17} />} onClick={() => { close(); setRole(m, 'member') }}>Ustaw jako pracownika</MenuItem>}
                  <MenuItem icon={<KeyRound size={17} />} onClick={() => { close(); reset(m) }}>Zresetuj hasło</MenuItem>
                  {m.user_id !== profile?.id && <MenuItem danger icon={<Trash2 size={17} />} onClick={() => { close(); remove(m) }}>Usuń z firmy</MenuItem>}
                </>
              )}
            </Menu>
          </div>
        ))}
      </div>

      <div className="roles">
        <div><b>Administrator</b><span>Dodaje ludzi do swojej firmy, rozstrzyga sporne zmiany, konfiguruje markę i import strony.</span></div>
        <div><b>Pracownik</b><span>Czyta i uzupełnia bazę, rozmawia z AI, podłącza swoją pocztę i Claude. Nie tworzy kont.</span></div>
        <div><b>Moderator</b><span>Tworzy firmy i przełącza się między nimi w menu w prawym górnym rogu.</span></div>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Nowe konto"
        subtitle={`${'Konto zostanie przypisane do firmy'} «${company.name}».`}
        footer={<><Button onClick={() => setAdding(false)}>Anuluj</Button><Button variant="primary" busy={busy} disabled={!f.email.includes('@')} onClick={add}>Utwórz</Button></>}>
        <div className="form">
          <Field label="E-mail"><input className="input" type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="imie@firma.pl" /></Field>
          <Field label="Imię i nazwisko"><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Rola">
            <Segmented value={f.role} onChange={(role) => setF({ ...f, role })} options={[{ value: 'member', label: 'Pracownik' }, { value: 'admin', label: 'Administrator' }]} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!creds} onClose={() => setCreds(null)} width={460} title={creds?.existed ? 'Konto dodane do firmy' : 'Dane logowania'}
        subtitle={creds?.existed ? 'Ta osoba ma już konto AURORA — hasło pozostaje bez zmian.' : 'Hasło jest widoczne tylko raz. Przekaż je osobie osobiście.'}
        footer={<Button variant="primary" onClick={() => setCreds(null)}>Gotowe</Button>}>
        {creds && !creds.existed && creds.password && (
          <div className="form">
            <Field label="E-mail"><CodeLine text={creds.email} /></Field>
            <Field label="Hasło"><CodeLine text={creds.password} /></Field>
          </div>
        )}
      </Modal>
    </Page>
  )
}
