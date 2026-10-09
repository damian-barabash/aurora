import { Check, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../app/session'
import { Avatar, Badge, Button, Menu, MenuItem, Spinner, useFeedback } from '../components/ui'
import { api } from '../lib/supabase'

interface Account {
  id: string
  email: string
  full_name: string
  is_moderator: boolean
  companies: { company_id: string; role: 'admin' | 'member' }[]
}

/**
 * Moderator przypisuje konta do firm. Administrator i pracownik widzą wyłącznie firmy, do których zostali
 * przypisani tutaj (albo w „Zespole” danej firmy) — dostępu do wszystkiego nie ma nikt poza moderatorem.
 */
export function AccessMatrix() {
  const { companies, reload: reloadSession } = useSession()
  const { fail, toast, confirm } = useFeedback()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const load = useCallback(async () => {
    try {
      setAccounts((await api<{ accounts: Account[] }>('list_accounts')).accounts)
    } catch (e) {
      fail(e)
    }
  }, [fail])
  useEffect(() => { load() }, [load])

  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? '—'
  const assign = async (a: Account, company_id: string, role: 'admin' | 'member') => {
    try {
      await api('assign_member', { user_id: a.id, company_id, role })
      toast(`${a.full_name || a.email}: ${nameOf(company_id)} — ${role === 'admin' ? 'administrator' : 'pracownik'}`)
      await load()
      reloadSession()
    } catch (e) {
      fail(e)
    }
  }
  const unassign = async (a: Account, company_id: string) => {
    if (!(await confirm({ title: 'Odebrać dostęp do firmy?', text: `${a.full_name || a.email} przestanie widzieć „${nameOf(company_id)}”. Konto zostaje.`, action: 'Odbierz dostęp', danger: true }))) return
    try {
      await api('remove_member', { user_id: a.id, company_id, keep_account: true })
      await load()
      reloadSession()
    } catch (e) {
      fail(e)
    }
  }

  if (!accounts) return <div className="row"><Spinner /></div>
  return (
    <div className="access">
      {accounts.map((a) => {
        const free = companies.filter((c) => !a.companies.some((x) => x.company_id === c.id))
        return (
          <div key={a.id} className="access__row">
            <Avatar name={a.full_name || a.email} size={38} />
            <div className="access__who">
              <b className="truncate">{a.full_name || a.email}</b>
              <small className="truncate">{a.email}</small>
            </div>
            <div className="access__chips">
              {a.is_moderator && <Badge tone="dark">Moderator · wszystkie firmy</Badge>}
              {a.companies.map((x) => (
                <span key={x.company_id} className={`access__chip${x.role === 'admin' ? ' is-admin' : ''}`}>
                  <Menu align="left" trigger={(_, toggle) => <button type="button" onClick={toggle} title="Zmień rolę">{nameOf(x.company_id)} · {x.role === 'admin' ? 'administrator' : 'pracownik'}</button>}>
                    {(close) => (
                      <>
                        <MenuItem active={x.role === 'admin'} icon={x.role === 'admin' ? <Check size={17} /> : <span className="menu__gap" />} onClick={() => { close(); assign(a, x.company_id, 'admin') }}>Administrator</MenuItem>
                        <MenuItem active={x.role === 'member'} icon={x.role === 'member' ? <Check size={17} /> : <span className="menu__gap" />} onClick={() => { close(); assign(a, x.company_id, 'member') }}>Pracownik</MenuItem>
                      </>
                    )}
                  </Menu>
                  <button type="button" aria-label="Odbierz dostęp" onClick={() => unassign(a, x.company_id)}><X size={14} /></button>
                </span>
              ))}
              {!a.is_moderator && !a.companies.length && <Badge tone="accent">Bez dostępu</Badge>}
              {free.length > 0 && (
                <Menu align="left" trigger={(_, toggle) => <Button size="sm" icon={<Plus size={15} />} onClick={toggle}>Przypisz do firmy</Button>}>
                  {(close) => free.flatMap((c) => [
                    <div key={`${c.id}-l`} className="menu__label">{c.name}</div>,
                    <MenuItem key={`${c.id}-a`} onClick={() => { close(); assign(a, c.id, 'admin') }}>jako administrator</MenuItem>,
                    <MenuItem key={`${c.id}-m`} onClick={() => { close(); assign(a, c.id, 'member') }}>jako pracownik</MenuItem>,
                  ])}
                </Menu>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
