import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_KEY as string

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aurora_auth' },
})

export const FUNCTIONS_URL = `${url}/functions/v1`

const ERRORS: Record<string, [string, string]> = {
  forbidden: ['Недостаточно прав', 'Brak uprawnień'],
  unauthorized: ['Сессия истекла, войдите снова', 'Sesja wygasła, zaloguj się ponownie'],
  invalid_email: ['Проверьте адрес почты', 'Sprawdź adres e-mail'],
  last_admin: ['В фирме должен остаться хотя бы один админ', 'W firmie musi zostać co najmniej jeden admin'],
  google_not_configured: ['Google ещё не настроен модератором', 'Google nie jest jeszcze skonfigurowany przez moderatora'],
  not_connected: ['Почта не подключена', 'Poczta nie jest podłączona'],
  text_too_short: ['Слишком короткий текст', 'Tekst jest za krótki'],
  unsupported_file: ['Этот формат пока не читается: подойдут PDF, DOCX, TXT, MD, CSV', 'Ten format nie jest jeszcze obsługiwany: PDF, DOCX, TXT, MD, CSV'],
  no_text_in_file: ['В файле не нашлось текста', 'W pliku nie znaleziono tekstu'],
  bad_url: ['Проверьте адрес сайта', 'Sprawdź adres strony'],
  name_required: ['Укажите название', 'Podaj nazwę'],
}

export class ApiError extends Error {
  constructor(public code: string) {
    super(code)
  }
  text(lang: 'ru' | 'pl') {
    const hit = ERRORS[this.code]
    return hit ? hit[lang === 'pl' ? 1 : 0] : this.code
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

/** Podpisane adresy plików z prywatnego bucketu. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return {}
  const { data } = await supabase.storage.from('media').createSignedUrls(unique, 3600)
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]))
}
