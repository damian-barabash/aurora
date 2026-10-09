// Скриншоты всех экранов на живом dev-сервере + ошибки консоли и горизонтальный скролл.
// node scripts/shots.mjs [desktop|mobile] [route…]
import { mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import puppeteer from 'puppeteer-core'
import { env, sql, ensureDemo } from './env.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const OUT = process.env.QC_OUT ?? 'qc-out'
const mode = process.argv[2] === 'mobile' ? 'mobile' : 'desktop'
const only = process.argv.slice(3)
const cache = `${homedir()}/.cache/puppeteer/chrome`
const ver = readdirSync(cache).sort().pop()
const executablePath = `${cache}/${ver}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport(mode === 'mobile' ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1 })
// tylko firma demonstracyjna; stan «Szybkiego startu» moderatora wraca po zdjęciach
const { id: demo, cleanup } = await ensureDemo()
const [{ onboarding }] = await sql(`select onboarding from public.profiles where email = '${env.MODERATOR_EMAIL}'`)
await sql(`update public.profiles set onboarding = '{}' where email = '${env.MODERATOR_EMAIL}'`)
await page.evaluateOnNewDocument((id) => localStorage.setItem('aurora_company', id), demo)
const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`))
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`))

const shot = async (name, full = false) => {
  await new Promise((r) => setTimeout(r, 900))
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (wide) problems.push(`overflow-x: ${name}`)
  await page.screenshot({ path: `${OUT}/${mode}-${name}.png`, fullPage: full })
  console.log('·', name)
}
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 60000 }) }
const want = (n) => !only.length || only.includes(n)

if (want('landing')) { await go('/'); await page.evaluate(() => document.querySelectorAll('.rv').forEach((e) => e.classList.add('in'))); await shot('landing', true) }
await go('/login')
if (want('login')) await shot('login')
await page.type('input[type=email]', env.MODERATOR_EMAIL)
await page.type('input[type=password]', env.MODERATOR_PASSWORD)
await page.click('button[type=submit]')
await page.waitForSelector('.shell', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 1500))
if (want('onboarding')) await shot('onboarding')
// закрываем «Быстрый старт», чтобы он улетел в угол
if (await page.$('.ob .modal__close')) { await page.click('.ob .modal__close'); await new Promise((r) => setTimeout(r, 900)) }

const routes = { home: '/app', chat: '/app/chat', kb: '/app/kb', news: '/app/news', review: '/app/review', files: '/app/files', brand: '/app/brand/identity', integrations: '/app/integrations', team: '/app/team', gaps: '/app/gaps', settings: '/app/settings' }
for (const [name, path] of Object.entries(routes)) {
  if (!want(name)) continue
  await go(path)
  await shot(name)
}
if (want('product')) {
  await go('/app/kb')
  await page.click('.pcard')
  await page.waitForSelector('.phead')
  await shot('product')
}
console.log(problems.length ? `\nПроблемы:\n${[...new Set(problems)].join('\n')}` : '\nБез ошибок консоли и горизонтального скролла')
await sql(`update public.profiles set onboarding = '${JSON.stringify(onboarding)}' where email = '${env.MODERATOR_EMAIL}'`)
await cleanup()
await browser.close()
