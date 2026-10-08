// Сквозной сценарий в браузере: чат с источниками, создание сотрудника, права сотрудника, удаление.
import { mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import puppeteer from 'puppeteer-core'
import { env, sql } from './env.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const OUT = process.env.QC_OUT ?? 'qc-out'
mkdirSync(OUT, { recursive: true })
const cache = `${homedir()}/.cache/puppeteer/chrome`
const executablePath = `${cache}/${readdirSync(cache).sort().pop()}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const browser = await puppeteer.launch({ executablePath, headless: 'new' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0, bad = 0
const check = (name, pass, extra = '') => { pass ? ok++ : bad++; console.log(pass ? '✓' : '✗', name, extra) }

async function login(ctx, email, password) {
  const page = await ctx.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('aurora_lang', 'ru'))
  page.on('pageerror', (e) => check('pageerror', false, e.message))
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForSelector('.shell', { timeout: 30000 })
  await wait(1500)
  return page
}

const TEST = 'e2e-member@aurora.test'
await sql(`delete from auth.users where email = '${TEST}'`)
await sql(`update public.profiles set onboarding = '{}' where email = '${env.MODERATOR_EMAIL}'`)

const mod = await login(browser.defaultBrowserContext(), env.MODERATOR_EMAIL, env.MODERATOR_PASSWORD)
check('онбординг открылся при входе', !!(await mod.$('.ob__box')))
await mod.click('.ob .modal__close')
await wait(1000)
check('плашка «Быстрый старт» в левом нижнем углу', !!(await mod.$('#qs-dock .qs')))
const dock = await mod.$eval('#qs-dock .qs', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, h: innerHeight } })
check('плашка внизу слева', dock.x < 60 && dock.y > dock.h * 0.7, JSON.stringify(dock))

await mod.goto(`${BASE}/app/chat`, { waitUntil: 'networkidle0' })
await mod.type('.composer textarea', 'Сколько стоит тариф Team?')
await mod.keyboard.press('Enter')
await mod.waitForSelector('.msg__sources .srcchip', { timeout: 90000 })
const answer = await mod.$eval('.msg--ai .msg__body', (el) => el.textContent)
check('чат ответил по базе с источником', /49/.test(answer), answer.slice(0, 90))
check('адрес сменился на /app/chat/:id', /\/app\/chat\/[0-9a-f-]{36}/.test(mod.url()))
await mod.screenshot({ path: `${OUT}/e2e-chat.png` })

await mod.goto(`${BASE}/app/team`, { waitUntil: 'networkidle0' })
await mod.click('.page__head .btn--accent')
await mod.waitForSelector('.modal input[type=email]')
await mod.type('.modal input[type=email]', TEST)
await mod.type('.modal .form .field:nth-child(2) input', 'Тест Сотрудник')
await mod.click('.modal__foot .btn--primary')
await mod.waitForSelector('.modal .code', { timeout: 20000 })
const [, password] = await mod.$$eval('.modal .code', (els) => els.map((e) => e.textContent.trim()))
check('пароль показан один раз', /^\w{4}-\w{4}-\w{4}$/.test(password), password.replace(/\w/g, '•'))
await mod.screenshot({ path: `${OUT}/e2e-creds.png` })

const ctx = await browser.createBrowserContext()
const member = await login(ctx, TEST, password)
const navText = await member.$eval('.side', (el) => el.textContent)
check('сотрудник не видит «Команда» и «Пробелы»', !/Команда|Пробелы/.test(navText))
check('сотрудник видит продукты фирмы', await (async () => { await member.goto(`${BASE}/app/kb`, { waitUntil: 'networkidle0' }); return (await member.$$('.pcard')).length === 6 })())
const token = await member.evaluate(() => JSON.parse(localStorage.getItem('aurora_auth')).access_token)
const [{ id: cid }] = await sql(`select id from public.companies where slug = 'aurora'`)
const res = await fetch(`https://${env.SUPABASE_REF}.supabase.co/functions/v1/api`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'create_user', company_id: cid, email: 'x@aurora.test', role: 'admin' }),
})
const denied = [(await res.json()).error]
check('сотрудник не может создавать аккаунты', denied[0] === 'forbidden', denied[0])
await member.goto(`${BASE}/app/team`, { waitUntil: 'networkidle0' })
check('страница «Команда» закрыта для сотрудника', !member.url().endsWith('/team'))
await ctx.close()

await sql(`delete from auth.users where email = '${TEST}'`)
await sql(`delete from public.chats`)
console.log(`\n${ok} ok, ${bad} failed`)
await browser.close()
process.exit(bad ? 1 : 0)
