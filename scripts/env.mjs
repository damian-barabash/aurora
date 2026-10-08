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
