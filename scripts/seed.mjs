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

const { company } = await api('create_company', { name: 'AURORA', website: 'https://aurora.fastline.pl', description: 'Демо-фирма: база знаний самого продукта AURORA.' })
const cid = company.id
const [platforms, services, learning] = await rest('collections', [
  { company_id: cid, name: 'Платформы', icon: 'grid', position: 0 },
  { company_id: cid, name: 'Сервисы', icon: 'folder', position: 1 },
  { company_id: cid, name: 'Обучение', icon: 'book', position: 2 },
])

const products = await rest('products', [
  { company_id: cid, collection_id: platforms.id, name: 'AURORA Chat', kind: 'Платформа', icon: 'spark', summary: 'AI-помощник для работы с идеями, текстами и знаниями команды.', description: 'Чат отвечает только по базе знаний фирмы и показывает источники каждого ответа.' },
  { company_id: cid, collection_id: platforms.id, name: 'AURORA Studio', kind: 'Приложение', icon: 'bloom', summary: 'Рабочее пространство для контента и визуальных материалов бренда.', description: '' },
  { company_id: cid, collection_id: services.id, name: 'AURORA Flow', kind: 'Сервис', icon: 'flow', summary: 'Автоматизация задач и повторяющихся процессов внутри команды.', description: '' },
  { company_id: cid, collection_id: services.id, name: 'AURORA Insights', kind: 'Сервис', icon: 'orbit', summary: 'Исследования, аналитика и выводы для продуктовых решений.', description: '' },
  { company_id: cid, collection_id: services.id, name: 'AURORA Connect', kind: 'Интеграции', icon: 'direction', summary: 'Связь между продуктами, партнёрскими сервисами и данными.', description: 'Gmail, Google Calendar и Claude подключаются в один клик.' },
  { company_id: cid, collection_id: learning.id, name: 'AURORA Academy', kind: 'Обучение', icon: 'dawn', summary: 'Обучающие программы и практические материалы для команды.', description: '' },
])
const pid = Object.fromEntries(products.map((p) => [p.name, p.id]))

const entries = await rest('entries', [
  { company_id: cid, product_id: pid['AURORA Chat'], type: 'fact', title: 'Ответы только по базе знаний', body: 'AURORA Chat отвечает на вопросы о продуктах, ценах и датах только на основании записей базы знаний и ставит номера источников после каждого факта.', importance: 2 },
  { company_id: cid, product_id: pid['AURORA Chat'], type: 'fact', title: 'Приватная переписка не попадает в ответы', body: 'Письма сотрудников не хранятся. ИИ извлекает из почты только подтверждённые факты о продуктах; личное и внутренние переговоры отбрасываются.', importance: 2 },
  { company_id: cid, product_id: pid['AURORA Chat'], type: 'price', title: 'Тариф Team', body: 'Тариф Team стоит 49 EUR за пользователя в месяц при оплате за год. Минимум 5 пользователей.', effective_from: '2026-10-01', importance: 2 },
  { company_id: cid, product_id: pid['AURORA Connect'], type: 'fact', title: 'Подключение почты', body: 'Каждый сотрудник подключает Gmail одним кликом через Google. Доступ только на чтение; отключить можно в любой момент в разделе «Интеграции».', importance: 1 },
  { company_id: cid, product_id: pid['AURORA Connect'], type: 'fact', title: 'MCP-сервер для Claude', body: 'Claude подключается к базе знаний по персональной ссылке. Он ищет факты в AURORA и предлагает обновить базу, когда узнаёт новое.', importance: 1 },
  { company_id: cid, product_id: pid['AURORA Academy'], type: 'date', title: 'Вводный вебинар для новых команд', body: 'Вводный вебинар по работе с базой знаний проходит онлайн 20 октября 2026 в 11:00 (Warsaw).', effective_from: '2026-10-20', effective_to: '2026-10-20', importance: 1 },
  { company_id: cid, product_id: pid['AURORA Insights'], type: 'fact', title: 'Отчёт «Пробелы в знаниях»', body: 'Insights показывает администратору вопросы из чата, на которые в базе не нашлось ответа.', importance: 1, status: 'review' },
  { company_id: cid, product_id: null, type: 'announcement', title: 'AURORA запущена в тестовом режиме', body: 'С 8 октября 2026 платформа работает на тестовом домене aurora.fastline.pl. Подключите почту и Claude в разделе «Интеграции».', effective_from: '2026-10-08', importance: 3, pinned: true },
])

await j(await fetch(`${base}/rest/v1/brand?company_id=eq.${cid}`, {
  method: 'PATCH', headers: me,
  body: JSON.stringify({
    tagline: 'A continuous line. A distinct signature.',
    strategy: 'AURORA — штаб знаний фирмы. Все данные о продуктах собираются в одном месте и обновляются сами: из почты, календаря, сайта и разговоров с Claude.',
    audience: 'Команды 5–200 человек: руководители, продажи, маркетинг и поддержка, которым нужны актуальные факты о продуктах.',
    tone: 'Спокойно, ясно, по делу. Короткие предложения. Без канцелярита и восклицательных знаков. Конкретные значения вместо общих слов.',
    dos: 'Называть продукт полностью: AURORA Chat, AURORA Flow.\nПисать даты числом и месяцем.\nПоказывать источник факта.',
    donts: 'Не обещать того, чего нет в базе.\nНе использовать градиенты, тени и шум в графике.\nНе писать AURORA строчными.',
    colors: [{ name: 'Black', hex: '#000000' }, { name: 'White', hex: '#FFFFFF' }, { name: 'Accent', hex: '#FDADA4' }],
    fonts: [{ role: 'Заголовки и текст', name: 'Inter' }, { role: 'Логотип', name: 'AURORA custom wordmark' }],
  }),
}))
await api('embed', { ids: entries.map((e) => e.id) })
console.log('✓ firma demo AURORA:', products.length, 'produktów,', entries.length, 'wpisów')
