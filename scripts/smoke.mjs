// Szybki test backendu na żywym projekcie: czat, import tekstu (prywatne odpada, konflikt do kolejki), MCP.
import { readFileSync } from 'node:fs'
import { env, sql } from './env.mjs'

const base = `https://${env.SUPABASE_REF}.supabase.co`
const anon = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/VITE_SUPABASE_KEY=(.*)/)[1]
const session = await (await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ email: env.MODERATOR_EMAIL, password: env.MODERATOR_PASSWORD }),
})).json()
const h = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }
const api = async (action, body = {}) => (await fetch(`${base}/functions/v1/api`, { method: 'POST', headers: h, body: JSON.stringify({ action, ...body }) })).json()
const [{ id: cid }] = await sql(`select id from public.companies where slug = 'aurora'`)

async function ask(message) {
  const t0 = Date.now()
  const r = await fetch(`${base}/functions/v1/chat`, { method: 'POST', headers: h, body: JSON.stringify({ company_id: cid, message }) })
  const text = await r.text()
  const answer = [...text.matchAll(/event: delta\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).t).join('')
  const done = JSON.parse(text.match(/event: done\ndata: (.*)/)?.[1] ?? '{}')
  console.log(`\nQ: ${message}\nA (${Date.now() - t0} ms, gap=${done.gap}, src=${done.sources?.length}): ${answer}`)
}
await ask('Ile kosztuje pakiet Team?')
await ask('Jaki jest adres biura w Warszawie?')

console.log('\nimport_text →', await api('import_text', {
  company_id: cid, label: 'smoke',
  text: 'Potwierdzamy: od 1 grudnia 2026 taryfa Team w AURORA Chat kosztuje 59 EUR za użytkownika miesięcznie. Nowy produkt AURORA Voice — asystent głosowy dla recepcji — startuje 15 stycznia 2027. Prywatnie: Kasia z księgowości jest na zwolnieniu do piątku, a moje hasło do banku to 1234.',
}))
console.log('proposals →', await sql(`select kind, summary, status from public.proposals where company_id = '${cid}'`))
console.log('nowe wpisy →', await sql(`select title, source, left(body, 90) body from public.entries where company_id = '${cid}' and source = 'file'`))

const { token, url } = await api('mcp_token_create', { company_id: cid, name: 'smoke' })
const rpc = async (method, params, id = 1) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })).json()
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })
console.log('\nMCP init →', init.result.serverInfo, '· tools:', (await rpc('tools/list', {})).result.tools.map((t) => t.name).join(', '))
console.log('MCP search →', (await rpc('tools/call', { name: 'aurora_search', arguments: { query: 'cena Team' } })).result.content[0].text.slice(0, 400))
console.log('MCP zły token →', (await fetch(url + 'x', { method: 'POST', body: '{}' })).status)
await sql(`delete from public.mcp_tokens where name = 'smoke'`)
