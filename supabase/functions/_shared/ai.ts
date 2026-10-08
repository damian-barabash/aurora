// Barabash AI — bramka zgodna z OpenAI. Rozumowanie (think) jest domyślnie wyłączone po stronie bramki.

const BASE = (Deno.env.get('BARABASH_AI_URL') ?? 'https://barabash-ai.tailcd3444.ts.net/v1').replace(/\/$/, '')
const KEY = Deno.env.get('BARABASH_AI_KEY')!
export const MODEL = Deno.env.get('AI_MODEL') ?? 'qwen3.5:27b'
const EMBED_MODEL = Deno.env.get('AI_EMBED_MODEL') ?? 'nomic-embed-text:latest'

export interface Msg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const headers = { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let last = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (r.ok) return r
    last = `${r.status} ${(await r.text()).slice(0, 300)}`
    if (r.status !== 429 && r.status < 500) break
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
  }
  throw new Error(`AI ${path}: ${last}`)
}

export async function chat(messages: Msg[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const r = await post('/chat/completions', {
    model: MODEL,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1200,
  })
  const d = await r.json()
  return d.choices?.[0]?.message?.content ?? ''
}

export async function chatJSON<T>(system: string, user: string, maxTokens = 1800): Promise<T | null> {
  const raw = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0, maxTokens },
  )
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

/** Strumień fragmentów tekstu odpowiedzi. */
export async function* chatStream(messages: Msg[], signal?: AbortSignal): AsyncGenerator<string> {
  const r = await post('/chat/completions', { model: MODEL, messages, stream: true, temperature: 0.3, max_tokens: 1500 }, signal)
  const reader = r.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const piece = JSON.parse(data).choices?.[0]?.delta?.content
        if (piece) yield piece
      } catch { /* niepełna linia SSE */ }
    }
  }
}

export async function embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
  if (!texts.length) return []
  const r = await post('/embeddings', {
    model: EMBED_MODEL,
    input: texts.map((t) => `search_${kind}: ${t.slice(0, 6000)}`),
  })
  const d = await r.json()
  return d.data.map((x: { embedding: number[] }) => x.embedding)
}

export const toVector = (v: number[]) => `[${v.join(',')}]`
