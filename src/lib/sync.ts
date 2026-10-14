// Synchronizacja z serwerem: każdy zapis (baza, pliki, funkcje) przechodzi przez trackedFetch.
// Panel pokazuje mały postęp w prawym dolnym rogu, przy błędzie — okno z wyjaśnieniem, bez internetu — komunikat.
// Czat ma własny strumień i tu nie trafia.

import { useSyncExternalStore } from 'react'

export type FailureReason = 'offline' | 'session' | 'denied' | 'conflict' | 'invalid' | 'server'

export interface Failure {
  /** co próbowaliśmy zrobić, np. „Zapisywanie marki” */
  what: string
  /** dlaczego się nie udało — prostym językiem */
  why: string
  reason: FailureReason
  /** szczegół techniczny (kod, adres) dla zgłoszenia */
  detail?: string
  retry?: () => Promise<unknown>
  at: number
}

interface State {
  running: number
  /** liczniki bieżącej serii zapisów (zerują się, gdy wszystko się skończy) */
  done: number
  total: number
  label: string
  /** chwila zakończenia ostatniej serii — przez moment pokazujemy „Zapisano” */
  savedAt: number
  /** w bieżącej serii był błąd — na końcu nie pokazujemy „Zapisano” */
  burstFailed: boolean
  failure: Failure | null
  online: boolean
}

let state: State = { running: 0, done: 0, total: 0, label: '', savedAt: 0, burstFailed: false, failure: null, online: typeof navigator === 'undefined' ? true : navigator.onLine }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useSync = () => useSyncExternalStore(subscribe, () => state)

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => set({ online: true }))
  window.addEventListener('offline', () => set({ online: false }))
}

/** Ostatni błąd synchronizacji — `fail()` nie dubluje go tostem. */
export const recentFailure = (ms = 3000) => !!state.failure && Date.now() - state.failure.at < ms

export function reportFailure(f: Omit<Failure, 'at'>) {
  // ten sam błąd zgłaszają warstwa sieci i wywołujący — zostaje jeden, najlepiej z „Spróbuj ponownie”
  if (state.failure && Date.now() - state.failure.at < 2000) {
    if (f.retry && !state.failure.retry) set({ failure: { ...state.failure, retry: f.retry } })
    return
  }
  set({ failure: { ...f, at: Date.now() }, burstFailed: true })
}
export const dismissFailure = () => set({ failure: null })

// ── opis żądania po polsku ──
const TABLES: Record<string, string> = {
  entries: 'wpisu', products: 'produktu', brands: 'marki', brand_clusters: 'kategorii', brand: 'profilu marki',
  files: 'pliku', collections: 'kolekcji', proposals: 'propozycji', chats: 'czatu', subscriptions: 'obserwowania',
  profiles: 'profilu', companies: 'firmy', company_members: 'zespołu', social_posts: 'posta',
}
const ACTIONS: Record<string, string> = {
  extract_file: 'Zlecanie czytania pliku', import_text: 'Import tekstu', import_site: 'Import strony', proposal_apply: 'Zatwierdzanie zmiany',
  proposal_reject: 'Odrzucanie zmiany', proposal_bulk: 'Decyzja dla kilku zmian', create_user: 'Dodawanie osoby', mcp_token_create: 'Tworzenie linku dla Claude',
  embed: 'Indeksowanie wpisu', social_publish: 'Publikacja posta', digest_now: 'Tworzenie podsumowania',
}

const READS = new Set(['google_status', 'platform_get', 'list_accounts', 'social_list', 'social_posts', 'social_draft', 'google_start', 'social_connect'])

function describe(url: URL, method: string, body?: BodyInit | null): string | null {
  const p = url.pathname
  if (p.includes('/auth/v1/') || p.includes('/functions/v1/chat') || p.includes('/object/sign')) return null
  if (p.includes('/functions/v1/')) {
    let action = ''
    try { action = typeof body === 'string' ? JSON.parse(body).action ?? '' : '' } catch { /* nie JSON */ }
    // akcje tylko do odczytu (statusy, listy, szkice) nie są zapisem
    if (READS.has(action)) return null
    return ACTIONS[action] ?? 'Zapisywanie'
  }
  if (p.includes('/storage/v1/object')) return method === 'DELETE' ? 'Usuwanie pliku' : 'Wgrywanie pliku'
  const table = p.match(/\/rest\/v1\/([\w]+)/)?.[1] ?? ''
  if (table === 'notifications') return null
  if (table === 'rpc') return 'Zapisywanie'
  const noun = TABLES[table]
  if (!noun) return 'Zapisywanie'
  return method === 'DELETE' ? `Usuwanie ${noun}` : method === 'POST' ? `Dodawanie ${noun}` : `Zapisywanie ${noun}`
}

function explain(status: number, body: string): { why: string; reason: FailureReason } {
  let msg = ''
  let code = ''
  try {
    const j = JSON.parse(body)
    msg = j.message ?? j.error ?? j.msg ?? ''
    code = j.code ?? ''
  } catch { msg = body.slice(0, 200) }
  if (status === 401) return { reason: 'session', why: 'Sesja wygasła. Zaloguj się ponownie — niezapisana zmiana nie trafiła na serwer.' }
  if (status === 403 || code === '42501' || /row-level security|forbidden/i.test(msg)) return { reason: 'denied', why: 'Nie masz uprawnień do tej zmiany. Poproś administratora firmy.' }
  if (status === 409 || code === '23505') return { reason: 'conflict', why: 'Taki element już istnieje (np. ta sama nazwa). Zmień nazwę i spróbuj ponownie.' }
  if (status >= 500) return { reason: 'server', why: `Serwer chwilowo nie odpowiada poprawnie (${status}). Zmiana nie została zapisana — spróbuj ponownie za chwilę.` }
  return { reason: 'invalid', why: msg ? `Serwer odrzucił zmianę: ${msg}` : `Serwer odrzucił zmianę (${status}).` }
}

/** fetch dla klienta Supabase i akcji serwera: zapisy są liczone, błędy wyjaśniane. */
export async function trackedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  const label = method === 'GET' || method === 'HEAD' ? null : describe(url, method, init.body)
  if (!label) {
    try {
      return await fetch(input, init)
    } catch (e) {
      if (!navigator.onLine) set({ online: false })
      throw e
    }
  }
  set({ running: state.running + 1, total: state.total + 1, label })
  const finish = () => {
    const running = state.running - 1
    set(running > 0 ? { running, done: state.done + 1 } : { running: 0, done: 0, total: 0, label: '', savedAt: state.burstFailed ? 0 : Date.now(), burstFailed: false })
  }
  try {
    const res = await fetch(input, init)
    if (!res.ok) {
      const text = await res.clone().text().catch(() => '')
      const { why, reason } = explain(res.status, text)
      reportFailure({ what: label, why, reason, detail: `${method} ${url.pathname.replace(/^.*\/(rest|storage|functions)\/v1/, '/$1')} → ${res.status}` })
    }
    finish()
    return res
  } catch (e) {
    finish()
    const offline = !navigator.onLine
    if (offline) set({ online: false })
    reportFailure({
      what: label, reason: 'offline',
      why: offline
        ? 'Brak połączenia z internetem. Zmiana nie została zapisana — spróbuj ponownie, gdy połączenie wróci.'
        : 'Nie udało się połączyć z serwerem AURORA. Sprawdź internet i spróbuj ponownie.',
      detail: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}

/**
 * Zapis w tle: interfejs zmienia się od razu, a serwer dostaje zmianę po cichu.
 * Gdy się nie uda — okno z wyjaśnieniem i przyciskiem „Spróbuj ponownie” (oraz `onError`, żeby cofnąć zmianę w widoku).
 */
export function background(what: string, run: () => Promise<unknown>, onError?: () => void) {
  const attempt = async (): Promise<unknown> => {
    try {
      // supabase-js nie rzuca wyjątków — błąd przychodzi w polu `error`
      const res = await run() as { error?: { message?: string } | null } | undefined
      if (res && typeof res === 'object' && 'error' in res && res.error) throw new Error(res.error.message ?? 'error')
      return res
    } catch (e) {
      onError?.()
      reportFailure({ what, why: e instanceof Error ? e.message : String(e), reason: navigator.onLine ? 'invalid' : 'offline', retry: attempt })
    }
  }
  return attempt()
}
