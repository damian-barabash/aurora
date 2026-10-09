// Audyt czytelności: na każdym ekranie liczy kontrast tekstu do tła (WCAG) i wypisuje wszystko poniżej progu.
// Wymaga `npm run dev`. Próg 4.5 dla zwykłego tekstu, 3 dla dużego (≥ 24 px lub ≥ 18.66 px pogrubione).
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import puppeteer from 'puppeteer-core'
import { env, sql, ensureDemo } from './env.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const cache = `${homedir()}/.cache/puppeteer/chrome`
const executablePath = `${cache}/${readdirSync(cache).sort().pop()}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const browser = await puppeteer.launch({ executablePath, headless: 'new' })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
// tylko firma demonstracyjna; stan «Szybkiego startu» moderatora wraca po audycie
const { id: demo, cleanup } = await ensureDemo()
const [{ onboarding }] = await sql(`select onboarding from public.profiles where email = '${env.MODERATOR_EMAIL}'`)
await sql(`update public.profiles set onboarding = '{}' where email = '${env.MODERATOR_EMAIL}'`)
await page.evaluateOnNewDocument((id) => localStorage.setItem('aurora_company', id), demo)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const audit = () => page.evaluate(() => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
  const bgOf = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) { stack.push(c); if (c.a === 1) break } } return stack.reduceRight((acc, c) => over(c, acc), { r: 255, g: 255, b: 255, a: 1 }) }
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.trim()
    const el = node.parentElement
    if (text.length < 2 || !el) continue
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (!rect.width || cs.visibility === 'hidden' || +cs.opacity === 0) continue
    // całkowita przezroczystość przodków (np. wyłączony przycisk) też obniża kontrast
    let alpha = 1
    for (let n = el; n; n = n.parentElement) alpha *= +getComputedStyle(n).opacity
    if (alpha === 0) continue
    const bg = bgOf(el)
    const fg = over({ ...parse(cs.color), a: parse(cs.color).a * alpha }, bg)
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    const ratio = (a + 0.05) / (b + 0.05)
    const size = parseFloat(cs.fontSize)
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 600)
    const disabled = !!el.closest('button:disabled, [aria-disabled=true]')
    if (ratio < (large ? 3 : 4.5)) out.push({ ratio: +ratio.toFixed(2), text: text.slice(0, 40), el: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, in: el.closest('[class]')?.parentElement?.className?.toString().split(' ')[0] ?? '', disabled })
  }
  return out
})

const results = {}
const run = async (name) => { await wait(700); const bad = (await audit()).filter((x) => !x.disabled); if (bad.length) results[name] = bad }
const go = async (path) => page.goto(BASE + path, { waitUntil: 'networkidle0' })

await go('/'); await page.evaluate(() => document.querySelectorAll('.rv').forEach((e) => e.classList.add('in'))); await run('landing')
await go('/login'); await run('login')
await page.type('input[type=email]', env.MODERATOR_EMAIL); await page.type('input[type=password]', env.MODERATOR_PASSWORD); await page.click('button[type=submit]')
await page.waitForSelector('.shell'); await wait(1500); await run('onboarding')
if (await page.$('.ob .modal__close')) { await page.click('.ob .modal__close'); await wait(900) }
for (const [name, path] of Object.entries({ home: '/app', chat: '/app/chat', kb: '/app/kb', news: '/app/news', review: '/app/review', files: '/app/files', brand: '/app/brand/identity', tone: '/app/brand/tone', integrations: '/app/integrations', team: '/app/team', gaps: '/app/gaps', settings: '/app/settings' })) { await go(path); await run(name) }
// każdy produkt (w tym ten z prośbą o sprawdzenie) i jego zakładki
const ids = (await sql(`select id from public.products where company_id = '${demo}'`)).map((r) => r.id)
for (const id of ids) {
  await go(`/app/kb/${id}`); await run(`product ${id.slice(0, 4)}`)
  for (const i of [1, 2]) { await page.evaluate((n) => document.querySelectorAll('.tabs__tab')[n]?.click(), i); await run(`product ${id.slice(0, 4)} tab${i}`) }
}
await sql(`update public.profiles set onboarding = '${JSON.stringify(onboarding)}' where email = '${env.MODERATOR_EMAIL}'`)
await cleanup()
await browser.close()

const flat = Object.entries(results)
if (!flat.length) console.log('Kontrast w porządku na wszystkich ekranach')
for (const [name, bad] of flat) {
  console.log(`\n${name}`)
  const seen = new Set()
  for (const x of bad) { const k = `${x.el}|${x.ratio}`; if (seen.has(k)) continue; seen.add(k); console.log(`  ${x.ratio}  ${x.el}  „${x.text}”`) }
}
process.exit(flat.length ? 1 : 0)
