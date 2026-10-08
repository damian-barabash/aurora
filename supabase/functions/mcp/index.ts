// Serwer MCP (Streamable HTTP, JSON-RPC) dla Claude. Token osobisty: nagłówek Bearer albo ostatni segment adresu.

import { embed, toVector } from '../_shared/ai.ts'
import { cors, db, json, sha256 } from '../_shared/core.ts'
import { ingestText } from '../_shared/ingest.ts'

const PROTOCOL = '2025-06-18'

const INSTRUCTIONS = `AURORA is the company knowledge base: products, prices, dates, announcements and brand rules. It is the source of truth for company facts.
- Before answering questions about the company's products, prices, dates or brand, call aurora_search (or aurora_get_product) and rely on the result.
- When during the conversation you notice NEW or CHANGED company information that is not in AURORA (a new price, date, feature, decision, announcement), ask the user: "Zaktualizować to w AURORA?" (in the language of the conversation).
  • user agrees → call aurora_propose_update with confirmed_by_user=true (applied immediately, visible in history)
  • user wants to check it personally or is unsure → call aurora_propose_update with confirmed_by_user=false (goes to the review inbox in AURORA)
- Never send private information to AURORA: personal data, private conversations, salaries, HR, credentials. Only company-wide knowledge.`

const tools = [
  {
    name: 'aurora_search',
    description: 'Semantic search in the company knowledge base (facts, prices, dates, news, announcements). Returns the most relevant entries with product, date and status.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look for, in natural language' }, limit: { type: 'number', description: '1–20, default 8' } },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aurora_list_products',
    description: 'List all company products with a short summary, status and last change date.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aurora_get_product',
    description: 'Full card of one product: description and all current entries (facts, prices, dates).',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Product name (or part of it)' } }, required: ['name'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aurora_latest_changes',
    description: 'What changed in the knowledge base recently, including important announcements.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Look back N days, default 7' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aurora_get_brand',
    description: 'Brand profile: strategy, audience, tone of voice, do/don\'t rules, colors and fonts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'aurora_propose_update',
    description: 'Add or change company knowledge in AURORA. ALWAYS ask the user first. confirmed_by_user=true applies the change now; false puts it into the review inbox for a human to check. Only company-wide, non-private information.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short specific title, max 80 chars' },
        body: { type: 'string', description: 'Full statement with concrete values (numbers, currency, dates)' },
        product: { type: 'string', description: 'Product name this is about; omit for general company knowledge' },
        type: { type: 'string', enum: ['fact', 'price', 'date', 'news', 'announcement', 'faq', 'link'] },
        effective_from: { type: 'string', description: 'YYYY-MM-DD, when it starts to apply' },
        confirmed_by_user: { type: 'boolean', description: 'true only if the user explicitly agreed to update AURORA now' },
      },
      required: ['title', 'body', 'confirmed_by_user'],
    },
  },
]

interface Ctx {
  userId: string
  companyId: string
  userName: string
}

// deno-lint-ignore no-explicit-any
const fmt = (e: any) =>
  `• ${e.product_name ?? e.product?.name ? `[${e.product_name ?? e.product?.name}] ` : ''}${e.title} (${e.type}${e.effective_from ? `, from ${e.effective_from}` : ''}` +
  `${e.status === 'review' ? ', NEEDS REVIEW' : ''}, updated ${String(e.updated_at).slice(0, 10)})\n  ${e.body}`

// deno-lint-ignore no-explicit-any
async function callTool(ctx: Ctx, name: string, a: Record<string, any>): Promise<string> {
  switch (name) {
    case 'aurora_search': {
      const query = String(a.query ?? '').slice(0, 500)
      if (!query) return 'query is required'
      const [vec] = await embed([query], 'query')
      const { data } = await db.rpc('match_entries', {
        p_company: ctx.companyId, p_embedding: toVector(vec), p_query: query.slice(0, 200), p_limit: Math.min(20, Math.max(1, Number(a.limit) || 8)),
      })
      // deno-lint-ignore no-explicit-any
      const hits = ((data ?? []) as any[]).filter((e) => e.score > 0.3)
      return hits.length ? hits.map(fmt).join('\n\n') : 'Nothing relevant in AURORA yet. If the user knows the answer, offer to add it with aurora_propose_update.'
    }
    case 'aurora_list_products': {
      const { data } = await db.from('products_v').select('name, kind, summary, state, entries_count, last_change')
        .eq('company_id', ctx.companyId).neq('status', 'archived').order('name')
      return data?.length
        ? data.map((p) => `• ${p.name}${p.kind ? ` (${p.kind})` : ''} — ${p.summary || 'no summary'} [${p.entries_count} entries, ${p.state === 'review' ? 'NEEDS REVIEW' : 'current'}, changed ${String(p.last_change).slice(0, 10)}]`).join('\n')
        : 'No products in AURORA yet.'
    }
    case 'aurora_get_product': {
      const { data: p } = await db.from('products').select('id, name, kind, summary, description').eq('company_id', ctx.companyId)
        .neq('status', 'archived').ilike('name', `%${String(a.name ?? '').replace(/[%_]/g, ' ').trim()}%`).limit(1).maybeSingle()
      if (!p) return `Product "${a.name}" not found. Use aurora_list_products to see the names.`
      const { data: entries } = await db.from('entries').select('type, title, body, effective_from, status, updated_at')
        .eq('product_id', p.id).in('status', ['current', 'review']).order('importance', { ascending: false }).order('updated_at', { ascending: false }).limit(60)
      return `# ${p.name}${p.kind ? ` (${p.kind})` : ''}\n${p.summary}\n\n${p.description}\n\n${(entries ?? []).map(fmt).join('\n\n') || 'No entries yet.'}`
    }
    case 'aurora_latest_changes': {
      const since = new Date(Date.now() - Math.min(90, Math.max(1, Number(a.days) || 7)) * 86400_000).toISOString()
      const { data } = await db.from('entries').select('type, title, body, effective_from, status, updated_at, importance, product:products(name)')
        .eq('company_id', ctx.companyId).in('status', ['current', 'review']).gte('updated_at', since)
        .order('importance', { ascending: false }).order('updated_at', { ascending: false }).limit(30)
      return data?.length ? data.map(fmt).join('\n\n') : 'No changes in this period.'
    }
    case 'aurora_get_brand': {
      const [{ data: c }, { data: b }] = await Promise.all([
        db.from('companies').select('name, description, website').eq('id', ctx.companyId).single(),
        db.from('brand').select('*').eq('company_id', ctx.companyId).maybeSingle(),
      ])
      // deno-lint-ignore no-explicit-any
      const colors = ((b?.colors ?? []) as any[]).map((x) => `${x.name ?? ''} ${x.hex}`).join(', ')
      // deno-lint-ignore no-explicit-any
      const fonts = ((b?.fonts ?? []) as any[]).map((x) => `${x.role ?? ''}: ${x.name}`).join(', ')
      return [
        `# ${c?.name}`, c?.description, c?.website,
        b?.tagline && `Tagline: ${b.tagline}`, b?.strategy && `## Strategy\n${b.strategy}`, b?.audience && `## Audience\n${b.audience}`,
        b?.tone && `## Tone of voice\n${b.tone}`, b?.dos && `## Do\n${b.dos}`, b?.donts && `## Don't\n${b.donts}`,
        colors && `Colors: ${colors}`, fonts && `Fonts: ${fonts}`,
      ].filter(Boolean).join('\n\n')
    }
    case 'aurora_propose_update': {
      const title = String(a.title ?? '').trim()
      const body = String(a.body ?? '').trim()
      if (!title || !body) return 'title and body are required'
      const confirmed = a.confirmed_by_user === true
      const res = await ingestText({
        companyId: ctx.companyId,
        source: 'claude',
        label: `Claude · ${ctx.userName}`,
        sourceUser: ctx.userId,
        trusted: confirmed,
        reviewOnly: !confirmed,
        productHint: a.product ? String(a.product) : null,
        text: `Statement provided by an employee through the assistant${confirmed ? ' and explicitly confirmed by them' : ''}.\n` +
          `Type: ${a.type ?? 'fact'}\n${a.product ? `Product: ${a.product}\n` : ''}${a.effective_from ? `Effective from: ${a.effective_from}\n` : ''}` +
          `Title: ${title}\n${body}`,
      })
      if (res.applied) return `Done — AURORA updated (${res.titles.join('; ')}). The change is in the product history and can be reverted there.`
      if (res.proposed) return `Saved to the AURORA review inbox (${res.titles.join('; ')}). ${confirmed ? 'It differs from what the base already says or adds a new product, so a human has to pick the right version.' : 'The user can approve it in AURORA → „Do sprawdzenia”.'}`
      return 'Nothing was changed: AURORA already contains this information, or it looked private and was skipped.'
    }
  }
  return `Unknown tool: ${name}`
}

async function auth(req: Request): Promise<Ctx | null> {
  const url = new URL(req.url)
  const fromPath = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') ||
    (fromPath.startsWith('aur_') ? fromPath : '') || url.searchParams.get('token') || ''
  if (!token.startsWith('aur_')) return null
  const { data: row } = await db.from('mcp_tokens').select('id, user_id, company_id, calls').eq('token_hash', await sha256(token)).is('revoked_at', null).maybeSingle()
  if (!row) return null
  const [{ data: member }, { data: prof }] = await Promise.all([
    db.from('company_members').select('role').eq('company_id', row.company_id).eq('user_id', row.user_id).maybeSingle(),
    db.from('profiles').select('full_name, email, is_moderator').eq('id', row.user_id).single(),
  ])
  if (!member && !prof?.is_moderator) return null
  await db.from('mcp_tokens').update({ last_used_at: new Date().toISOString(), calls: row.calls + 1 }).eq('id', row.id)
  return { userId: row.user_id, companyId: row.company_id, userName: prof?.full_name || prof?.email || '' }
}

// deno-lint-ignore no-explicit-any
async function handle(ctx: Ctx, msg: any): Promise<unknown | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
  if (msg.id === undefined || msg.id === null) return null // powiadomienia bez odpowiedzi
  switch (msg.method) {
    case 'initialize': {
      const { data: c } = await db.from('companies').select('name').eq('id', ctx.companyId).single()
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'aurora', title: `AURORA · ${c?.name ?? ''}`, version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools })
    case 'tools/call':
      try {
        const text = await callTool(ctx, msg.params?.name, msg.params?.arguments ?? {})
        return reply({ content: [{ type: 'text', text }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `AURORA error: ${e instanceof Error ? e.message : e}` }], isError: true })
      }
    case 'resources/list':
      return reply({ resources: [] })
    case 'prompts/list':
      return reply({ prompts: [] })
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'AURORA MCP server: use POST (Streamable HTTP)' }, 405, { allow: 'POST' })
  const ctx = await auth(req)
  if (!ctx) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid or revoked AURORA token' } }, 401)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(ctx, m)))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: cors })
  }
  const out = await handle(ctx, body)
  return out ? json(out) : new Response(null, { status: 202, headers: cors })
})
