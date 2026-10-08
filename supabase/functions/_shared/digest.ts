// Poranny dajdżest: co zmieniło się w bazie wiedzy od poprzedniego podsumowania.

import { chat } from './ai.ts'
import { db, today } from './core.ts'

export async function generateDigest(companyId: string, force = false): Promise<string | null> {
  const day = today()
  const { data: last } = await db.from('digests').select('day, created_at').eq('company_id', companyId)
    .order('day', { ascending: false }).limit(1).maybeSingle()
  if (last?.day === day && !force) return null
  const since = last && last.day !== day ? last.created_at : new Date(Date.now() - 24 * 3600_000).toISOString()

  const [{ data: company }, { data: changes }, { count: pending }] = await Promise.all([
    db.from('companies').select('name, settings').eq('id', companyId).single(),
    db.from('history').select('target, action, title, source, product_id, after, created_at')
      .eq('company_id', companyId).gte('created_at', since).order('created_at').limit(60),
    db.from('proposals').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending'),
  ])
  if (!company || (!changes?.length && !force)) return null

  const ids = [...new Set((changes ?? []).map((c) => c.product_id).filter(Boolean))]
  const { data: products } = ids.length ? await db.from('products').select('id, name').in('id', ids) : { data: [] }
  const nameOf = new Map((products ?? []).map((p) => [p.id, p.name]))
  const lines = (changes ?? []).map((c) => {
    const body = c.target === 'entry' ? String(c.after?.body ?? '').slice(0, 220) : String(c.after?.summary ?? '').slice(0, 160)
    return `- [${c.action}/${c.source}] ${c.product_id ? (nameOf.get(c.product_id) ?? 'product') + ': ' : ''}${c.title}${body ? ` — ${body}` : ''}`
  })

  const content = lines.length
    ? await chat([
      {
        role: 'system',
        content: `You write the morning digest of a company knowledge base for the whole team. Language: Polish. ` +
          `Format: Markdown, at most 6 short bullets, most important first, concrete values (prices, dates) kept exactly. ` +
          `Group changes of the same product. No greeting, no conclusion, no invented facts.`,
      },
      { role: 'user', content: `Company: ${company.name}\nChanges since the last digest:\n${lines.join('\n')}` },
    ], { maxTokens: 500 })
    : ''
  const stats = {
    changes: changes?.length ?? 0,
    products: ids.length,
    pending: pending ?? 0,
    by_source: (changes ?? []).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.source]: (acc[c.source] ?? 0) + 1 }), {}),
  }
  await db.from('digests').upsert({ company_id: companyId, day, content, stats, created_at: new Date().toISOString() }, { onConflict: 'company_id,day' })
  if (content) {
    const { data: members } = await db.from('company_members').select('user_id').eq('company_id', companyId)
    await db.from('notifications').insert((members ?? []).map((m) => ({
      user_id: m.user_id,
      company_id: companyId,
      type: 'digest',
      title: 'Poranne podsumowanie',
      body: content.replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220),
      link: '/app',
    })))
  }
  return content
}
