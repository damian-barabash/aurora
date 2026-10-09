// Sekrety do skryptów serwisowych: .env.server (poza gitem)
import { readFileSync } from 'node:fs'

export function loadEnv(file = '.env.server') {
  const env = {}
  for (const line of readFileSync(new URL('../' + file, import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

export const env = loadEnv()
export const API = `https://api.supabase.com/v1/projects/${env.SUPABASE_REF}`

export async function mgmt(path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${text.slice(0, 800)}`)
  try { return JSON.parse(text) } catch { return text }
}

export const sql = (query) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) })

/**
 * Firma demonstracyjna do testów. Jeśli jej nie ma (użytkownik ją usunął), zakładamy ją na czas testu
 * i sprzątamy po sobie — prawdziwych firm skrypty nie dotykają.
 */
export async function ensureDemo() {
  const find = async () => (await sql(`select id from public.companies where slug = 'aurora'`))[0]?.id
  let id = await find()
  const temporary = !id
  if (temporary) {
    const { execFileSync } = await import('node:child_process')
    execFileSync(process.execPath, [new URL('./seed.mjs', import.meta.url).pathname], { stdio: 'ignore' })
    id = await find()
  }
  return { id, cleanup: async () => { if (temporary) await sql(`delete from public.companies where id = '${id}'`) } }
}
