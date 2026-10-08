// Wdraża funkcje edge przez Management API. Pliki z _shared trafiają obok index.ts (importy ../_shared/ → ./).
import { readdirSync, readFileSync } from 'node:fs'
import { API, env } from './env.mjs'

const root = new URL('../supabase/functions/', import.meta.url)
const shared = readdirSync(new URL('_shared/', root)).filter((f) => f.endsWith('.ts'))
const only = process.argv.slice(2)
const slugs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared' && (!only.length || only.includes(d.name)))
  .map((d) => d.name)

for (const slug of slugs) {
  const form = new FormData()
  form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false }))
  const index = readFileSync(new URL(`${slug}/index.ts`, root), 'utf8').replaceAll('../_shared/', './')
  form.append('file', new Blob([index], { type: 'application/typescript' }), 'index.ts')
  for (const f of shared) {
    form.append('file', new Blob([readFileSync(new URL(`_shared/${f}`, root))], { type: 'application/typescript' }), f)
  }
  const r = await fetch(`${API}/functions/deploy?slug=${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
    body: form,
  })
  const text = await r.text()
  console.log(r.ok ? '✓' : '✗', slug, r.ok ? '' : `${r.status} ${text.slice(0, 600)}`)
  if (!r.ok) process.exitCode = 1
}
