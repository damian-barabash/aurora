// Stosuje migracje z supabase/migrations, których jeszcze nie ma w historii projektu.
// Management API nadaje własny numer wersji, więc porównujemy po nazwie migracji.
import { readdirSync, readFileSync } from 'node:fs'
import { mgmt, sql } from './env.mjs'

const dir = new URL('../supabase/migrations/', import.meta.url)
let applied = []
try {
  applied = (await sql('select name from supabase_migrations.schema_migrations')).map((r) => r.name)
} catch { /* brak tabeli historii = czysty projekt */ }

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const [, ...rest] = file.replace('.sql', '').split('_')
  if (applied.includes(rest.join('_'))) { console.log('·', file); continue }
  await mgmt('/database/migrations', {
    method: 'POST',
    body: JSON.stringify({ name: rest.join('_'), query: readFileSync(new URL(file, dir), 'utf8') }),
  })
  console.log('✓', file)
}
