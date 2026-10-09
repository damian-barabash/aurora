// Czat z bazą wiedzy: wyszukanie wpisów → odpowiedź strumieniowana (SSE) z numerowanymi źródłami.

import { chatStream, embed, type Msg, toVector } from '../_shared/ai.ts'
import { cors, db, fail, HttpError, requireMember, requireUser, today } from '../_shared/core.ts'

const NO_ANSWER = '[[NO_ANSWER]]'
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const me = await requireUser(req)
    const b = await req.json()
    const message = String(b.message ?? '').trim().slice(0, 4000)
    if (!message) throw new HttpError(400, 'empty_message')
    const useContext = b.use_context !== false
    // wyszukiwanie i dane firmy idą równolegle ze sprawdzeniem uprawnień — liczy się czas do pierwszego słowa
    const vecP = useContext ? embed([message], 'query') : null
    vecP?.catch(() => {})
    let chatId: string = b.chat_id
    const [, owned, { data: company }, { data: brand }, { data: products }, { data: past }] = await Promise.all([
      requireMember(me, b.company_id),
      chatId ? db.from('chats').select('id').eq('id', chatId).eq('user_id', me.id).maybeSingle() : null,
      db.from('companies').select('name, description').eq('id', b.company_id).single(),
      db.from('brand').select('tagline, tone, audience').eq('company_id', b.company_id).maybeSingle(),
      db.from('products').select('name, kind, summary').eq('company_id', b.company_id).neq('status', 'archived').limit(60),
      chatId ? db.from('chat_messages').select('role, content').eq('chat_id', chatId).order('created_at', { ascending: false }).limit(8) : { data: [] },
    ])
    if (chatId && !owned?.data) throw new HttpError(404, 'chat_not_found')
    if (!chatId) {
      const { data: created, error } = await db.from('chats').insert({
        company_id: b.company_id, user_id: me.id, title: message.replace(/\s+/g, ' ').slice(0, 70),
      }).select('id').single()
      if (error) throw new HttpError(400, error.message)
      chatId = created.id
    }
    const saved = db.from('chat_messages').insert({ chat_id: chatId, role: 'user', content: message }).then(() => {})

    // deno-lint-ignore no-explicit-any
    let sources: any[] = []
    if (vecP) {
      const [vec] = await vecP
      const { data } = await db.rpc('match_entries', {
        p_company: b.company_id, p_embedding: toVector(vec), p_query: message.slice(0, 200), p_limit: 8,
      })
      // deno-lint-ignore no-explicit-any
      sources = ((data ?? []) as any[]).filter((e) => e.score > 0.3)
    }
    // logo produktu i zdjęcia wpisów — klient pokaże je przy odpowiedzi
    if (sources.length) {
      const productIds = [...new Set(sources.map((e) => e.product_id).filter(Boolean))]
      const [{ data: logos }, { data: photos }] = await Promise.all([
        productIds.length ? db.from('products').select('id, logo_path').in('id', productIds) : { data: [] },
        db.from('files').select('entry_id, path').in('entry_id', sources.map((e) => e.id)).eq('kind', 'image').order('created_at'),
      ])
      const logoOf = new Map((logos ?? []).map((p) => [p.id, p.logo_path]))
      for (const e of sources) {
        e.logo = logoOf.get(e.product_id) ?? null
        e.images = (photos ?? []).filter((f) => f.entry_id === e.id).map((f) => f.path).slice(0, 4)
      }
    }
    await saved

    const context = sources.map((e, i) =>
      `[${i + 1}] ${e.product_name ? `(${e.product_name}) ` : ''}${e.title}\n${e.body}` +
      `${e.effective_from ? `\nValid from: ${e.effective_from}` : ''}${e.effective_to ? ` until: ${e.effective_to}` : ''}` +
      `\nUpdated: ${String(e.updated_at).slice(0, 10)}${e.status === 'review' ? ' (NEEDS REVIEW)' : ''}`
    ).join('\n\n')

    const system = useContext
      ? `You are AURORA — the knowledge assistant of the company "${company?.name}". Today is ${today()}.
You answer questions of employees using ONLY the knowledge base context below. The base contains company-wide knowledge about products, prices, dates, announcements and brand. You do not have access to anyone's private correspondence and never speculate about it.

RULES
- Company facts (prices, dates, features, conditions) come ONLY from the CONTEXT. Cite them with source numbers like [1] or [2][3] right after the sentence.
- If the context does not contain the answer, start your reply with exactly ${NO_ANSWER} and then say briefly that this is not in the knowledge base yet and what could be added. Do not invent.
- If a source is marked "NEEDS REVIEW" or looks outdated, say so.
- For writing tasks (posts, emails, descriptions) use the facts from the context and the brand tone of voice.
- Do not list source metadata (update dates, statuses) unless the user asks or it matters for the answer; write dates in a natural form.
- Answer in Polish; switch to another language only if the user writes in it. Be concise. Use Markdown (short paragraphs, lists, **bold** for key values).
${brand?.tone ? `\nBRAND TONE OF VOICE: ${brand.tone.slice(0, 600)}` : ''}${brand?.audience ? `\nAUDIENCE: ${brand.audience.slice(0, 300)}` : ''}

PRODUCTS OF THE COMPANY:
${(products ?? []).map((p) => `- ${p.name}${p.kind ? ` (${p.kind})` : ''}${p.summary ? `: ${p.summary.slice(0, 160)}` : ''}`).join('\n') || '(none yet)'}

CONTEXT:
${context || '(nothing relevant found)'}`
      : `You are AURORA — an assistant of the company "${company?.name}". The user turned the knowledge base context OFF: help with general tasks (ideas, texts, plans) and do not state company facts as certain. Answer in Polish unless the user writes in another language. Use Markdown.`

    const messages: Msg[] = [
      { role: 'system', content: system },
      ...((past ?? []).reverse().map((m) => ({ role: m.role, content: m.content.slice(0, 1500) })) as Msg[]),
      { role: 'user', content: message },
    ]

    const enc = new TextEncoder()
    const abort = new AbortController()
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(sse(event, data)))
        send('meta', {
          chat_id: chatId,
          sources: sources.map((e, i) => ({ n: i + 1, id: e.id, product_id: e.product_id, product: e.product_name, title: e.title, type: e.type, logo: e.logo ?? null, images: e.images ?? [] })),
        })
        let full = ''
        let head = ''
        let headDone = false
        let gap = false
        try {
          for await (const piece of chatStream(messages, abort.signal)) {
            if (!headDone) {
              // znacznik braku odpowiedzi stoi na samym początku — wstrzymujemy pierwsze znaki, żeby go wyciąć
              head += piece
              if (head.length < NO_ANSWER.length + 2 && NO_ANSWER.startsWith(head.trimStart().slice(0, NO_ANSWER.length))) continue
              headDone = true
              let out = head
              if (out.trimStart().startsWith(NO_ANSWER)) {
                gap = true
                out = out.trimStart().slice(NO_ANSWER.length).trimStart()
              }
              full += out
              if (out) send('delta', { t: out })
              continue
            }
            full += piece
            send('delta', { t: piece })
          }
          if (!headDone && head) {
            gap = head.includes(NO_ANSWER)
            full =head.replace(NO_ANSWER, '').trim()
            if (full) send('delta', { t: full })
          }
        } catch (e) {
          if (!full) {
            full = '⚠️ ' + (e instanceof Error ? e.message : 'AI error')
            send('error', { message: full })
          }
        }
        const cited = new Set([...full.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
        const used = sources.map((e, i) => ({ n: i + 1, id: e.id, product_id: e.product_id, product: e.product_name, title: e.title, type: e.type, logo: e.logo ?? null, images: e.images ?? [] }))
          .filter((s) => cited.has(s.n))
        if (full) {
          await db.from('chat_messages').insert({ chat_id: chatId, role: 'assistant', content: full, sources: used })
          await db.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId)
        }
        if (gap && useContext) {
          const q = message.replace(/\s+/g, ' ').slice(0, 300)
          const { data: same } = await db.from('knowledge_gaps').select('id, hits').eq('company_id', b.company_id)
            .eq('status', 'open').ilike('question', q.replace(/[%_]/g, ' ')).maybeSingle()
          if (same) await db.from('knowledge_gaps').update({ hits: same.hits + 1, updated_at: new Date().toISOString() }).eq('id', same.id)
          else await db.from('knowledge_gaps').insert({ company_id: b.company_id, question: q, user_id: me.id })
        }
        send('done', { gap, sources: used })
        ctrl.close()
      },
      cancel() {
        abort.abort()
      },
    })
    return new Response(stream, {
      headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
    })
  } catch (e) {
    return fail(e)
  }
})
