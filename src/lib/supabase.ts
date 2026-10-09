import { createClient } from '@supabase/supabase-js'

// Адрес проекта и publishable-ключ публичны (доступ ограничивает RLS), поэтому лежат в коде:
// сборка на GitHub Pages не зависит от переменных репозитория. Env нужен только для другого проекта.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://qgmhvvvpabyzaksntvxk.supabase.co'
const key = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || 'sb_publishable_VfMrxT45_dJeNubGt8Hf5w_wzJ1sNUC'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aurora_auth' },
})

export const FUNCTIONS_URL = `${url}/functions/v1`

const ERRORS: Record<string, string> = {
  forbidden: 'Brak uprawnień',
  unauthorized: 'Sesja wygasła, zaloguj się ponownie',
  invalid_email: 'Sprawdź adres e-mail',
  last_admin: 'W firmie musi zostać co najmniej jeden admin',
  google_not_configured: 'Google nie jest jeszcze skonfigurowany przez moderatora',
  not_connected: 'Poczta nie jest podłączona',
  text_too_short: 'Tekst jest za krótki',
  unsupported_file: 'Ten format nie jest jeszcze obsługiwany: PDF, DOCX, TXT, MD, CSV',
  no_text_in_file: 'W pliku nie znaleziono tekstu',
  bad_url: 'Sprawdź adres strony',
  name_required: 'Podaj nazwę',
}

export class ApiError extends Error {
  constructor(public code: string) {
    super(code)
  }
  text() {
    return ERRORS[this.code] ?? this.code
  }
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  return {
    apikey: key,
    Authorization: `Bearer ${data.session?.access_token ?? ''}`,
    'content-type': 'application/json',
  }
}

/** Akcje serwerowe (konta, integracje, import, propozycje). */
export async function api<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${FUNCTIONS_URL}/api`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(data.error ?? `http_${r.status}`)
  return data as T
}

export interface ChatSource {
  n: number
  id: string
  product_id: string | null
  product: string | null
  title: string
  type: string
  /** ścieżki w buckecie: logo produktu i zdjęcia przypięte do wpisu */
  logo?: string | null
  images?: string[]
}

/** Strumień odpowiedzi czatu (SSE). */
export async function streamChat(
  body: { company_id: string; chat_id?: string; message: string; use_context: boolean },
  on: { meta(m: { chat_id: string; sources: ChatSource[] }): void; delta(t: string): void; done(d: { gap: boolean; sources: ChatSource[] }): void },
  signal?: AbortSignal,
) {
  const r = await fetch(`${FUNCTIONS_URL}/chat`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body), signal })
  if (!r.ok || !r.body) throw new ApiError((await r.json().catch(() => ({}))).error ?? `http_${r.status}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const event = block.match(/^event: (.*)$/m)?.[1]
      const data = block.match(/^data: (.*)$/m)?.[1]
      if (!event || !data) continue
      const parsed = JSON.parse(data)
      if (event === 'meta') on.meta(parsed)
      else if (event === 'delta') on.delta(parsed.t)
      else if (event === 'done') on.done(parsed)
      else if (event === 'error') on.delta(parsed.message)
    }
  }
}

const signed = new Map<string, { url: string; exp: number }>()

/** Podpisane adresy plików z prywatnego bucketu. Wynik trzymamy 50 minut, żeby nie podpisywać tych samych ścieżek co ekran. */
export async function signedUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))]
  const now = Date.now()
  const missing = unique.filter((p) => (signed.get(p)?.exp ?? 0) < now)
  if (missing.length) {
    const { data } = await supabase.storage.from('media').createSignedUrls(missing, 3600)
    for (const d of data ?? []) if (d.signedUrl && d.path) signed.set(d.path, { url: d.signedUrl, exp: now + 50 * 60_000 })
  }
  return Object.fromEntries(unique.filter((p) => signed.has(p)).map((p) => [p, signed.get(p)!.url]))
}
