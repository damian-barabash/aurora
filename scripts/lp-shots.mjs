// Prawdziwe ekrany panelu do sekcji hero na stronie głównej → public/lp/*.webp (wymaga `npm run dev`).
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import puppeteer from 'puppeteer-core'
import { env, sql } from './env.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const cache = `${homedir()}/.cache/puppeteer/chrome`
const executablePath = `${cache}/${readdirSync(cache).sort().pop()}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport({ width: 1360, height: 860, deviceScaleFactor: 2 })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// na czas zdjęć chowamy «Szybki start», potem wraca
await sql(`update public.profiles set onboarding = '{"closed_at":"2020-01-01T00:00:00Z"}' where email = '${env.MODERATOR_EMAIL}'`)
// dane demonstracyjne do zdjęć: konflikt źródeł, historia zmiany ceny i świeże podsumowanie
const [{ id: cid }] = await sql(`select id from public.companies where slug = 'aurora'`)
await sql(`
  delete from public.proposals where company_id = '${cid}' and dedupe_key = 'demo-conflict';
  insert into public.proposals (company_id, kind, source, source_label, product_id, entry_id, payload, summary, evidence, confidence, dedupe_key)
  select e.company_id, 'conflict', 'email', 'Gmail · Dmytrii Barabash', e.product_id, e.id,
    jsonb_build_object('type', 'price', 'title', 'Pakiet Team — nowa cena', 'body', 'Od 1 grudnia 2026 pakiet Team kosztuje 59 EUR za użytkownika miesięcznie przy płatności rocznej.', 'effective_from', '2026-12-01', 'effective_to', null, 'importance', 2),
    'AURORA Chat — Pakiet Team — nowa cena', 'W wiadomości do zespołu sprzedaży podano nową cenę pakietu, inną niż zapisana w bazie.', 0.74, 'demo-conflict'
  from public.entries e where e.company_id = '${cid}' and e.type = 'price';
  update public.entries set body = replace(body, '49 EUR', '45 EUR') where company_id = '${cid}' and type = 'price' and not exists (select 1 from public.history h where h.entry_id = entries.id and h.action = 'update');
  update public.entries set body = replace(body, '45 EUR', '49 EUR') where company_id = '${cid}' and type = 'price';
`)

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
await page.type('input[type=email]', env.MODERATOR_EMAIL)
await page.type('input[type=password]', env.MODERATOR_PASSWORD)
await page.click('button[type=submit]')
await page.waitForSelector('.shell')
const CSS = '.shell{padding:0!important}.side{border-radius:0!important;border:0!important;border-right:1px solid var(--line)!important}.shell__main{border:0!important;border-radius:0!important}.gsetup{display:none!important}*{animation:none!important}'
const open = async (path) => { await page.goto(BASE + path, { waitUntil: 'networkidle0' }); await page.addStyleTag({ content: CSS }) }
const snap = async (name) => { await wait(900); await page.screenshot({ path: `public/lp/${name}.webp`, type: 'webp', quality: 84 }); console.log('·', name) }

await open('/app')
if (!(await page.$('.digest .md'))) {
  await page.click('.digest__btn')
  await page.waitForSelector('.digest .md', { timeout: 90000 })
}
await snap('home')
await open('/app/kb'); await snap('kb')

await page.evaluate(() => [...document.querySelectorAll('.pcard')].find((c) => c.textContent.includes('AURORA Chat')).click())
await page.waitForSelector('.phead'); await page.addStyleTag({ content: CSS }); await snap('product')
await page.evaluate(() => document.querySelectorAll('.tabs__tab')[2].click())
await page.waitForSelector('.hist__head'); await page.click('.hist__head'); await snap('history')

await open('/app/review'); await snap('review')
await open('/app/news'); await snap('news')
await open('/app/brand/identity'); await snap('brand')
await open('/app/integrations')
await page.evaluate(() => document.querySelectorAll('.integ')[1].scrollIntoView({ block: 'start' }))
await snap('integrations')

await open('/app/chat')
await page.type('.composer textarea', 'Ile kosztuje pakiet Team i od kiedy obowiązuje ta cena?')
await page.keyboard.press('Enter')
await page.waitForSelector('.msg__sources .srcchip', { timeout: 90000 })
await snap('chat')

await sql(`update public.profiles set onboarding = '{}' where email = '${env.MODERATOR_EMAIL}'`)
await browser.close()
