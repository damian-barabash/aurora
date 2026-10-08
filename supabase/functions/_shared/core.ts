import { createClient } from 'npm:@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

export const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', ...headers } })

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const fail = (e: unknown) => {
  const status = e instanceof HttpError ? e.status : 500
  if (status === 500) console.error(e)
  return json({ error: e instanceof Error ? e.message : String(e) }, status)
}

export type Role = 'moderator' | 'admin' | 'member'
export interface Me {
  id: string
  email: string
  full_name: string
  is_moderator: boolean
}

export async function requireUser(req: Request): Promise<Me> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'unauthorized')
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'unauthorized')
  const { data: p } = await db.from('profiles').select('id, email, full_name, is_moderator').eq('id', data.user.id).single()
  if (!p) throw new HttpError(401, 'unauthorized')
  return p as Me
}

export async function roleIn(me: Me, companyId: string): Promise<Role | null> {
  if (me.is_moderator) return 'moderator'
  const { data } = await db.from('company_members').select('role').eq('company_id', companyId).eq('user_id', me.id).maybeSingle()
  return (data?.role as Role) ?? null
}

export async function requireMember(me: Me, companyId: string): Promise<Role> {
  if (!companyId) throw new HttpError(400, 'company_id required')
  const role = await roleIn(me, companyId)
  if (!role) throw new HttpError(403, 'forbidden')
  return role
}

export async function requireAdmin(me: Me, companyId: string): Promise<Role> {
  const role = await requireMember(me, companyId)
  if (role === 'member') throw new HttpError(403, 'forbidden')
  return role
}

// ── kryptografia: tokeny OAuth i sekrety platformy leżą w bazie zaszyfrowane ──

const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => new Uint8Array(s.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

let aesKey: Promise<CryptoKey> | null = null
const key = () =>
  (aesKey ??= crypto.subtle.importKey('raw', unhex(Deno.env.get('TOKEN_KEY')!), 'AES-GCM', false, ['encrypt', 'decrypt']))

export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(plain))
  return `${hex(iv)}.${hex(data)}`
}

export async function decrypt(packed: string): Promise<string> {
  const [iv, data] = packed.split('.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv) }, await key(), unhex(data))
  return new TextDecoder().decode(plain)
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

export const randomToken = (bytes = 24) => hex(crypto.getRandomValues(new Uint8Array(bytes)))

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await db.from('platform_settings').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

export async function setSetting(key: string, value: string) {
  await db.from('platform_settings').upsert({ key, value, updated_at: new Date().toISOString() })
}

export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date())
