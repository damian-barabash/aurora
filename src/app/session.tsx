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

/** Minimalne pobieranie danych: wynik, stan ładowania i ręczne odświeżenie. */
export function useQuery<T>(fn: () => PromiseLike<T>, deps: DependencyList): { data: T | undefined; loading: boolean; reload(): Promise<void>; set(v: T): void } {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.resolve(run()).then((d) => {
      if (!alive) return
      setData(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [run])
  const reload = useCallback(async () => {
    const d = await run()
    setData(d)
  }, [run])
  return { data, loading, reload, set: setData }
}
