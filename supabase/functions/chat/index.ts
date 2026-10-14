// Czat z bazą wiedzy: wyszukanie wpisów → odpowiedź strumieniowana (SSE) z numerowanymi źródłami.

import { chatStream, embed, type Msg, toVector } from '../_shared/ai.ts'
import { brandLabel, brandsInText, catalogText, loadCatalog, productsInText } from '../_shared/brands.ts'
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
    let chatId: string = b.chat_id
    // dane firmy idą równolegle ze sprawdzeniem uprawnień — liczy się czas do pierwszego słowa
    const [role, owned, cat, { data: profiles }, { data: past }] = await Promise.all([
      requireMember(me, b.company_id),
      chatId ? db.from('chats').select('id').eq('id', chatId).eq('user_id', me.id).maybeSingle() : null,
      loadCatalog(b.company_id),
      db.from('brand').select('brand_id, tagline, tone, audience, dos, donts').eq('company_id', b.company_id),
      chatId ? db.from('chat_messages').select('role, content').eq('chat_id', chatId).order('created_at', { ascending: false }).limit(8) : { data: [] },
    ])
    if (chatId && !owned?.data) throw new HttpError(404, 'chat_not_found')
    if (!cat) throw new HttpError(404, 'not_found')
    const company = cat.company

    // o którą markę chodzi: wybór w panelu, nazwa / alias / produkt w pytaniu, a przy krótkim dopytaniu — poprzednie pytanie
    const prevUser = (past ?? []).find((m) => m.role === 'user')?.content ?? ''
    const picked = typeof b.brand_id === 'string' && cat.brandById.has(b.brand_id) ? b.brand_id : null
    let mentioned = brandsInText(cat, message)
    const followUp = !mentioned.length && message.length < 120 && !!prevUser
    if (followUp) mentioned = brandsInText(cat, prevUser)
    const focus: string[] = picked ? [picked] : mentioned.slice(0, 3)
    const named = productsInText(cat, followUp ? `${prevUser}\n${message}` : message).slice(0, 3)
    const confidential = role !== 'member'
    const searchText = followUp ? `${prevUser.slice(0, 300)}\n${message}` : message
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
    if (useContext) {
      const [vec] = await embed([searchText], 'query')
      const v = toVector(vec)
      const searches = (focus.length ? focus : [null]).map((brand) => db.rpc('match_entries', {
        p_company: b.company_id, p_embedding: v, p_query: message.slice(0, 200), p_limit: focus.length > 1 ? 6 : 10,
        p_brand: brand, p_confidential: confidential,
      }))
      // produkt wymieniony z nazwy: jego najważniejsze wpisy trafiają do kontekstu nawet przy słabym dopasowaniu słów
      const direct = named.length
        ? db.from('entries').select('id, product_id, brand_id, type, title, body, effective_from, effective_to, updated_at, source, status, visibility')
          .in('product_id', named.map((p) => p.id)).in('status', ['current', 'review'])
          .order('importance', { ascending: false }).order('updated_at', { ascending: false }).limit(8)
        : null
      const [results, directRes] = await Promise.all([Promise.all(searches), direct])
      // deno-lint-ignore no-explicit-any
      const byId = new Map<string, any>()
      for (const r of results) {
        // deno-lint-ignore no-explicit-any
        for (const e of (r.data ?? []) as any[]) if (e.score > 0.3 && !byId.has(e.id)) byId.set(e.id, e)
      }
      // deno-lint-ignore no-explicit-any
      for (const e of (directRes?.data ?? []) as any[]) {
        if (byId.has(e.id) || (!confidential && e.visibility === 'confidential')) continue
        byId.set(e.id, { ...e, product_name: named.find((p) => p.id === e.product_id)?.name ?? null, score: 0.5 })
      }
      sources = [...byId.values()].sort((x, y) => y.score - x.score).slice(0, 12)
    }
    // logo produktu i zdjęcia wpisów — klient pokaże je przy odpowiedzi
    if (sources.length) {
      const productIds = [...new Set(sources.map((e) => e.product_id).filter(Boolean))]
      const brandIds = [...new Set(sources.map((e) => e.brand_id).filter(Boolean))]
      const [{ data: logos }, { data: brandLogos }, { data: photos }] = await Promise.all([
        productIds.length ? db.from('products').select('id, logo_path').in('id', productIds) : { data: [] },
        brandIds.length ? db.from('brands').select('id, logo_path').in('id', brandIds) : { data: [] },
        db.from('files').select('entry_id, path').in('entry_id', sources.map((e) => e.id)).eq('kind', 'image').order('created_at'),
      ])
      const logoOf = new Map((logos ?? []).map((p) => [p.id, p.logo_path]))
      const brandLogoOf = new Map((brandLogos ?? []).map((p) => [p.id, p.logo_path]))
      for (const e of sources) {
        e.logo = logoOf.get(e.product_id) ?? brandLogoOf.get(e.brand_id) ?? null
        e.images = (photos ?? []).filter((f) => f.entry_id === e.id).map((f) => f.path).slice(0, 4)
      }
    }
    await saved

    const context = sources.map((e, i) =>
      `[${i + 1}] (${brandLabel(cat, e.brand_id, e.product_name)}) ${e.title}${e.visibility === 'confidential' ? ' [CONFIDENTIAL]' : ''}\n${e.body}` +
      `${e.effective_from ? `\nValid from: ${e.effective_from}` : ''}${e.effective_to ? ` until: ${e.effective_to}` : ''}` +
      `\nUpdated: ${String(e.updated_at).slice(0, 16).replace('T', ' ')}${e.status === 'review' ? ' (NEEDS REVIEW)' : ''}${(e.effective_to ?? (e.type === 'date' ? e.effective_from : null)) && (e.effective_to ?? e.effective_from) < today() ? ' (PAST — already ended)' : ''}`
    ).join('\n\n')

    // ton: profil marki, o którą pytają (jedna), zawsze z zasadami całej grupy
    const groupProfile = (profiles ?? []).find((p) => !p.brand_id)
    const brandProfile = focus.length === 1 ? (profiles ?? []).find((p) => p.brand_id === focus[0]) : null
    const focusNames = focus.map((id) => cat.brandById.get(id)?.name).filter(Boolean)
    const voice = [
      brandProfile?.tone && `TONE OF VOICE OF ${focusNames[0]}: ${brandProfile.tone.slice(0, 600)}`,
      brandProfile?.audience && `AUDIENCE OF ${focusNames[0]}: ${brandProfile.audience.slice(0, 300)}`,
      brandProfile?.donts && `${focusNames[0]} NEVER: ${brandProfile.donts.slice(0, 300)}`,
      groupProfile?.tone && `GROUP-WIDE TONE: ${groupProfile.tone.slice(0, 300)}`,
      groupProfile?.donts && `GROUP-WIDE NEVER: ${groupProfile.donts.slice(0, 400)}`,
    ].filter(Boolean).join('\n')

    const system = useContext
      ? `You are AURORA — the knowledge assistant of the holding "${company.name}". Today is ${today()}.
The holding owns several BRANDS (grouped in clusters); each brand has its own products. You answer questions of employees using ONLY the knowledge base context below. You do not have access to anyone's private correspondence and never speculate about it.

STRUCTURE OF THE GROUP (brands and their products):
${catalogText(cat, { summaries: true })}
${focusNames.length ? `\nTHE QUESTION IS ABOUT: ${focusNames.join(', ')}.` : ''}

RULES
- Every context entry is labelled (Brand › Product) or (${company.name}) for group-wide knowledge. NEVER attribute a fact of one brand to another brand. When you state a price, date or condition, make clear which brand/product it belongs to.
- If the question does not say which brand and the context has answers for several brands, answer briefly per brand or ask which one is meant.
- Company facts (prices, dates, features, conditions) come ONLY from the CONTEXT. Cite them with source numbers like [1] or [2][3] right after the sentence.
- For questions about the structure of the group (which brands exist, what a brand does, which products a brand has) you may also use STRUCTURE OF THE GROUP above.
- If neither the context nor the structure contains the answer, start your reply with exactly ${NO_ANSWER} and then say briefly that this is not in the knowledge base yet and what could be added. Do not invent.
- If a source is marked "NEEDS REVIEW" or looks outdated, say so. "CONFIDENTIAL" sources are for internal use: mention that when the user asks for client-facing text.
- Sources marked "PAST" describe things that already ended: do not present them as current or upcoming; use them only when the user asks about the past.
- If two sources of the SAME brand give different values for the same thing, use the one with the later "Updated" time and say in one sentence that an older entry states otherwise.
- For writing tasks (posts, emails, descriptions) use the facts from the context and the tone of voice of the right brand.
- Do not list source metadata (update dates, statuses) unless the user asks or it matters for the answer; write dates in a natural form.
- Answer in Polish; switch to another language only if the user writes in it. Be concise. Use Markdown (short paragraphs, lists, **bold** for key values).
${voice ? `\n${voice}` : ''}

CONTEXT:
${context || '(nothing relevant found)'}`
      : `You are AURORA — an assistant of the holding "${company.name}". The user turned the knowledge base context OFF: help with general tasks (ideas, texts, plans) and do not state company facts as certain. Answer in Polish unless the user writes in another language. Use Markdown.`

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
          sources: sources.map((e, i) => ({ n: i + 1, id: e.id, product_id: e.product_id, product: e.product_name, brand_id: e.brand_id ?? null, brand: e.brand_id ? cat.brandById.get(e.brand_id)?.name ?? null : null, title: e.title, type: e.type, logo: e.logo ?? null, images: e.images ?? [] })),
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
        const used = sources.map((e, i) => ({ n: i + 1, id: e.id, product_id: e.product_id, product: e.product_name, brand_id: e.brand_id ?? null, brand: e.brand_id ? cat.brandById.get(e.brand_id)?.name ?? null : null, title: e.title, type: e.type, logo: e.logo ?? null, images: e.images ?? [] }))
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
