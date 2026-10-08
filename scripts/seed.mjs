// Konto moderatora + firma demonstracyjna z produktami z makiety. Bezpieczne do ponownego uruchomienia.
import { env, sql } from './env.mjs'

const base = `https://${env.SUPABASE_REF}.supabase.co`
const svc = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json' }
const j = async (r) => {
  const t = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 400)}`)
  return t ? JSON.parse(t) : null
}

const email = env.MODERATOR_EMAIL
const exists = await sql(`select id from auth.users where email = '${email}'`)
if (!exists.length) {
  await j(await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST', headers: svc,
    body: JSON.stringify({ email, password: env.MODERATOR_PASSWORD, email_confirm: true, user_metadata: { full_name: 'Dmytrii Barabash' } }),
  }))
  console.log('✓ konto moderatora')
}
await sql(`update public.profiles set is_moderator = true, full_name = 'Dmytrii Barabash' where email = '${email}'`)

const anon = (await sql(`select 1`)) && (await (await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })).json()).find((k) => k.type === 'publishable').api_key
const session = await j(await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: env.MODERATOR_PASSWORD }),
}))
const me = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json', Prefer: 'return=representation,missing=default' }
const api = async (action, body = {}) => j(await fetch(`${base}/functions/v1/api`, { method: 'POST', headers: me, body: JSON.stringify({ action, ...body }) }))
const rest = async (table, rows) => (await Promise.all(rows.map(async (row) => j(await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: me, body: JSON.stringify(row) }))))).flat()

if ((await sql(`select 1 from public.companies where slug = 'aurora'`)).length) {
  console.log('· firma demo już istnieje')
  process.exit(0)
}

const { company } = await api('create_company', { name: 'AURORA', website: 'https://aurora.fastline.pl', description: 'Firma demonstracyjna: baza wiedzy samego produktu AURORA.' })
const cid = company.id
const [platforms, services, learning] = await rest('collections', [
  { company_id: cid, name: 'Platformy', icon: 'grid', position: 0 },
  { company_id: cid, name: 'Usługi', icon: 'folder', position: 1 },
  { company_id: cid, name: 'Szkolenia', icon: 'book', position: 2 },
])

const products = await rest('products', [
  { company_id: cid, collection_id: platforms.id, name: 'AURORA Chat', kind: 'Platforma', icon: 'spark', summary: 'Asystent AI do pracy z pomysłami, tekstami i wiedzą zespołu.', description: 'Czat odpowiada tylko na podstawie bazy wiedzy firmy i pokazuje źródła każdej odpowiedzi.' },
  { company_id: cid, collection_id: platforms.id, name: 'AURORA Studio', kind: 'Aplikacja', icon: 'bloom', summary: 'Przestrzeń robocza dla treści i materiałów wizualnych marki.', description: '' },
  { company_id: cid, collection_id: services.id, name: 'AURORA Flow', kind: 'Usługa', icon: 'flow', summary: 'Automatyzacja zadań i powtarzalnych procesów w zespole.', description: '' },
  { company_id: cid, collection_id: services.id, name: 'AURORA Insights', kind: 'Usługa', icon: 'orbit', summary: 'Badania, analityka i wnioski dla decyzji produktowych.', description: '' },
  { company_id: cid, collection_id: services.id, name: 'AURORA Connect', kind: 'Integracje', icon: 'direction', summary: 'Połączenie między produktami, usługami partnerów i danymi.', description: 'Gmail, Google Calendar i Claude podłącza się jednym kliknięciem.' },
  { company_id: cid, collection_id: learning.id, name: 'AURORA Academy', kind: 'Szkolenia', icon: 'dawn', summary: 'Programy szkoleniowe i praktyczne materiały dla zespołu.', description: '' },
])
const pid = Object.fromEntries(products.map((p) => [p.name, p.id]))

const entries = await rest('entries', [
  { company_id: cid, product_id: pid['AURORA Chat'], type: 'fact', title: 'Odpowiedzi tylko z bazy wiedzy', body: 'AURORA Chat odpowiada na pytania o produkty, ceny i terminy wyłącznie na podstawie wpisów z bazy wiedzy i po każdym fakcie podaje numer źródła.', importance: 2 },
  { company_id: cid, product_id: pid['AURORA Chat'], type: 'fact', title: 'Prywatna korespondencja nie trafia do odpowiedzi', body: 'Wiadomości pracowników nie są przechowywane. AI wyciąga z poczty tylko potwierdzone fakty o produktach; sprawy prywatne i wewnętrzne negocjacje są odrzucane.', importance: 2 },
  { company_id: cid, product_id: pid['AURORA Chat'], type: 'price', title: 'Pakiet Team', body: 'Pakiet Team kosztuje 49 EUR za użytkownika miesięcznie przy płatności rocznej. Minimum 5 użytkowników.', effective_from: '2026-10-01', importance: 2 },
  { company_id: cid, product_id: pid['AURORA Connect'], type: 'fact', title: 'Podłączenie poczty', body: 'Każdy pracownik podłącza Gmail jednym kliknięciem przez Google. Dostęp tylko do odczytu; można go wyłączyć w każdej chwili w sekcji „Integracje”.', importance: 1 },
  { company_id: cid, product_id: pid['AURORA Connect'], type: 'fact', title: 'Serwer MCP dla Claude', body: 'Claude łączy się z bazą wiedzy przez osobisty link. Szuka faktów w AURORA i proponuje aktualizację bazy, gdy dowie się czegoś nowego.', importance: 1 },
  { company_id: cid, product_id: pid['AURORA Academy'], type: 'date', title: 'Webinar wprowadzający dla nowych zespołów', body: 'Webinar wprowadzający do pracy z bazą wiedzy odbędzie się online 20 października 2026 o 11:00 (Warszawa).', effective_from: '2026-10-20', effective_to: '2026-10-20', importance: 1 },
  { company_id: cid, product_id: pid['AURORA Insights'], type: 'fact', title: 'Raport „Luki w wiedzy”', body: 'Insights pokazuje administratorowi pytania z czatu, na które w bazie nie znaleziono odpowiedzi.', importance: 1, status: 'review' },
  { company_id: cid, product_id: null, type: 'announcement', title: 'AURORA działa w trybie testowym', body: 'Od 8 października 2026 platforma działa pod testowym adresem aurora.fastline.pl. Podłącz pocztę i Claude w sekcji „Integracje”.', effective_from: '2026-10-08', importance: 3, pinned: true },
])

await j(await fetch(`${base}/rest/v1/brand?company_id=eq.${cid}`, {
  method: 'PATCH', headers: me,
  body: JSON.stringify({
    tagline: 'A continuous line. A distinct signature.',
    strategy: 'AURORA to sztab wiedzy firmy. Wszystkie dane o produktach trafiają w jedno miejsce i aktualizują się same: z poczty, kalendarza, strony i rozmów z Claude.',
    audience: 'Zespoły 5–200 osób: zarząd, sprzedaż, marketing i obsługa klienta, które potrzebują aktualnych faktów o produktach.',
    tone: 'Spokojnie, jasno, konkretnie. Krótkie zdania. Bez urzędowego języka i wykrzykników. Konkretne wartości zamiast ogólników.',
    dos: 'Podawać pełną nazwę produktu: AURORA Chat, AURORA Flow.\nPisać daty dniem i miesiącem.\nPokazywać źródło faktu.',
    donts: 'Nie obiecywać tego, czego nie ma w bazie.\nNie używać gradientów, cieni i szumu w grafice.\nNie pisać AURORA małymi literami.',
    colors: [{ name: 'Black', hex: '#000000' }, { name: 'White', hex: '#FFFFFF' }, { name: 'Accent', hex: '#FDADA4' }],
    fonts: [{ role: 'Nagłówki i tekst', name: 'Inter' }, { role: 'Logotyp', name: 'AURORA custom wordmark' }],
  }),
}))
await api('embed', { ids: entries.map((e) => e.id) })
console.log('✓ firma demo AURORA:', products.length, 'produktów,', entries.length, 'wpisów')
