import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Member } from '../lib/types'
import { useSession } from './session'

/** Команда текущей фирмы и словарь «id → имя» для подписей в истории и на карточках. */
export function usePeople() {
  const { company, profile } = useSession()
  const [members, setMembers] = useState<Member[]>([])
  const reload = useCallback(async () => {
    if (!company) return
    const { data } = await supabase.from('company_members')
      .select('user_id, role, created_at, profile:profiles(id, email, full_name, is_moderator)')
      .eq('company_id', company.id).order('created_at')
    setMembers((data ?? []) as unknown as Member[])
  }, [company])
  useEffect(() => { reload() }, [reload])
  const names = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of members) map[m.user_id] = m.profile?.full_name || m.profile?.email || ''
    if (profile) map[profile.id] = profile.full_name || profile.email
    return map
  }, [members, profile])
  return { members, names, reload }
}
