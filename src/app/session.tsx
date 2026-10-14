import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type DependencyList, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, Profile, Role } from '../lib/types'

interface SessionCtx {
  loading: boolean
  session: Session | null
  profile: Profile | null
  companies: Company[]
  company: Company | null
  role: Role | null
  /** admin фирмы или модератор */
  canManage: boolean
  setCompany(id: string): void
  reload(): Promise<void>
  patchProfile(patch: Partial<Profile>): Promise<void>
  signOut(): Promise<void>
}

const Ctx = createContext<SessionCtx>(null!)
// Pamięć ostatnich wyników: wracając na ekran, widzisz dane od razu, a świeże dociągają się w tle.
const cache = new Map<string, unknown>()

const KEY = 'aurora_company'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string | null>(() => localStorage.getItem(KEY))

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      setCompanies([])
      setLoading(false)
      return
    }
    const [{ data: prof }, { data: list }, { data: mine }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).single(),
      supabase.from('companies').select('*').order('name'),
      supabase.from('company_members').select('company_id, role').eq('user_id', s.user.id),
    ])
    const roles = new Map((mine ?? []).map((m) => [m.company_id, m.role as Role]))
    setProfile(prof as Profile)
    setCompanies(((list ?? []) as Company[]).map((c) => ({ ...c, role: prof?.is_moderator ? 'moderator' : roles.get(c.id) ?? 'member' })))
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      load(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') cache.clear()
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') load(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const company = useMemo(() => companies.find((c) => c.id === companyId) ?? companies[0] ?? null, [companies, companyId])

  const value = useMemo<SessionCtx>(() => ({
    loading,
    session,
    profile,
    companies,
    company,
    role: company?.role ?? (profile?.is_moderator ? 'moderator' : null),
    canManage: !!profile?.is_moderator || company?.role === 'admin',
    setCompany(id) {
      localStorage.setItem(KEY, id)
      setCompanyId(id)
    },
    reload: () => load(session),
    async patchProfile(patch) {
      if (!profile) return
      setProfile({ ...profile, ...patch })
      await supabase.from('profiles').update(patch).eq('id', profile.id)
    },
    async signOut() {
      cache.clear()
      await supabase.auth.signOut()
    },
  }), [loading, session, profile, companies, company, load])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)

/** Bieżąca firma — w panelu zawsze istnieje (Shell pokazuje pusty stan, gdy firm brak). */
export function useCompany(): Company {
  return useContext(Ctx).company!
}

const keyOf = (fn: unknown, deps: DependencyList) => `${String(fn)}|${JSON.stringify(deps)}`

/**
 * Pobieranie danych w trybie „najpierw pokaż, potem odśwież”: przy ponownym wejściu na ekran
 * nie ma kręcącego się koła — od razu są poprzednie dane, a po chwili aktualne.
 */
export function useQuery<T>(fn: () => PromiseLike<T>, deps: DependencyList): { data: T | undefined; loading: boolean; reload(): Promise<void>; set(v: T): void } {
  const key = keyOf(fn, deps)
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined)
  const [loading, setLoading] = useState(() => !cache.has(key))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  useEffect(() => {
    let alive = true
    if (cache.has(key)) {
      setData(cache.get(key) as T)
      setLoading(false)
    } else setLoading(true)
    Promise.resolve(run()).then((d) => {
      if (!alive) return
      cache.set(key, d)
      setData(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])
  const reload = useCallback(async () => {
    const d = await run()
    cache.set(key, d)
    setData(d)
  }, [run, key])
  const put = useCallback((v: T) => {
    cache.set(key, v)
    setData(v)
  }, [key])
  return { data, loading, reload, set: put }
}
