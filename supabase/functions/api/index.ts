// Jedna funkcja na wszystkie akcje panelu, które wymagają klucza serwisowego lub modelu AI.

import {
  APP_URL, cors, db, encrypt, fail, FUNCTIONS_URL, getSetting, HttpError, json, type Me, randomToken,
  requireAdmin, requireMember, requireUser, setSetting, sha256,
} from '../_shared/core.ts'
import { generateDigest } from '../_shared/digest.ts'
import { GOOGLE_SCOPES, googleClient, REDIRECT_URI, stripHtml, syncIntegration } from '../_shared/google.ts'
import { applyProposal, embedEntries, ingestText } from '../_shared/ingest.ts'
import { crawlStep, safeUrl, startCrawl } from '../_shared/web.ts'

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>
// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<any>): void }

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'firma'

const genPassword = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => abc[b % abc.length]).join('')
  return `${pick.slice(0, 4)}-${pick.slice(4, 8)}-${pick.slice(8)}`
}

const requireModerator = (me: Me) => {
  if (!me.is_moderator) throw new HttpError(403, 'forbidden')
}

async function adminCount(companyId: string) {
  const { count } = await db.from('company_members').select('user_id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('role', 'admin')
  return count ?? 0
}

const actions: Record<string, (me: Me, b: Body) => Promise<unknown>> = {
  // ───────── firmy i konta ─────────
  async create_company(me, b) {
    requireModerator(me)
    const name = String(b.name ?? '').trim()
    if (name.length < 2) throw new HttpError(400, 'name_required')
    let slug = slugify(name)
    const { data: taken } = await db.from('companies').select('slug').like('slug', `${slug}%`)
    if (taken?.some((t) => t.slug === slug)) slug = `${slug}-${(taken?.length ?? 0) + 1}`
    const { data: company, error } = await db.from('companies').insert({
      name, slug, website: b.website || null, description: b.description ?? '', created_by: me.id,
    }).select('*').single()
    if (error) throw new HttpError(400, error.message)
    await Promise.all([
      db.from('company_members').insert({ company_id: company.id, user_id: me.id, role: 'admin' }),
      db.from('brand').insert({ company_id: company.id }),
    ])
    return { company }
  },

  async delete_company(me, b) {
    requireModerator(me)
    const { data: files } = await db.from('files').select('path').eq('company_id', b.company_id)
    if (files?.length) await db.storage.from('media').remove(files.map((f) => f.path))
    const { error } = await db.from('companies').delete().eq('id', b.company_id)
    if (error) throw new HttpError(400, error.message)
    return { ok: true }
  },

  async create_user(me, b) {
    await requireAdmin(me, b.company_id)
    const email = String(b.email ?? '').trim().toLowerCase()
    const role = b.role === 'admin' ? 'admin' : 'member'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'invalid_email')
    const { data: existing } = await db.from('profiles').select('id').ilike('email', email).maybeSingle()
    let userId = existing?.id as string | undefined
    let password: string | null = null
    if (!userId) {
      password = genPassword()
      const { data, error } = await db.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: String(b.full_name ?? '').trim() },
      })
      if (error || !data.user) throw new HttpError(400, error?.message ?? 'create_failed')
      userId = data.user.id
      await db.from('profiles').upsert({ id: userId, email, full_name: String(b.full_name ?? '').trim() })
    }
    const { error } = await db.from('company_members').upsert({ company_id: b.company_id, user_id: userId, role })
    if (error) throw new HttpError(400, error.message)
    return { user_id: userId, email, password, existed: !password }
  },

  async update_member(me, b) {
    await requireAdmin(me, b.company_id)
    const role = b.role === 'admin' ? 'admin' : 'member'
    if (role === 'member') {
      const { data: cur } = await db.from('company_members').select('role').eq('company_id', b.company_id).eq('user_id', b.user_id).single()
      if (cur?.role === 'admin' && (await adminCount(b.company_id)) <= 1) throw new HttpError(400, 'last_admin')
    }
    await db.from('company_members').update({ role }).eq('company_id', b.company_id).eq('user_id', b.user_id)
    return { ok: true }
  },

  async remove_member(me, b) {
    await requireAdmin(me, b.company_id)
    const { data: target } = await db.from('profiles').select('id, is_moderator').eq('id', b.user_id).single()
    if (!target) throw new HttpError(404, 'not_found')
    const { data: cur } = await db.from('company_members').select('role').eq('company_id', b.company_id).eq('user_id', b.user_id).maybeSingle()
    if (cur?.role === 'admin' && (await adminCount(b.company_id)) <= 1) throw new HttpError(400, 'last_admin')
    await db.from('company_members').delete().eq('company_id', b.company_id).eq('user_id', b.user_id)
    await db.from('integrations').delete().eq('company_id', b.company_id).eq('user_id', b.user_id)
    await db.from('mcp_tokens').delete().eq('company_id', b.company_id).eq('user_id', b.user_id)
    // konto bez żadnej firmy nie ma po co istnieć; moderatora nie usuwamy nigdy
    const { count } = await db.from('company_members').select('company_id', { count: 'exact', head: true }).eq('user_id', b.user_id)
    if (!count && !target.is_moderator) await db.auth.admin.deleteUser(b.user_id)
    return { ok: true }
  },

  async reset_password(me, b) {
    await requireAdmin(me, b.company_id)
    const { data: target } = await db.from('profiles').select('is_moderator').eq('id', b.user_id).single()
    if (target?.is_moderator && !me.is_moderator) throw new HttpError(403, 'forbidden')
    const { data: member } = await db.from('company_members').select('user_id').eq('company_id', b.company_id).eq('user_id', b.user_id).maybeSingle()
    if (!member) throw new HttpError(404, 'not_found')
    const password = genPassword()
    const { error } = await db.auth.admin.updateUserById(b.user_id, { password })
    if (error) throw new HttpError(400, error.message)
    return { password }
  },

  // ───────── ustawienia platformy (moderator) ─────────
  async platform_get(me) {
    requireModerator(me)
    const [id, secret] = await Promise.all([getSetting('google_client_id'), getSetting('google_client_secret')])
    return { google_client_id: id ?? '', google_secret_set: !!secret, redirect_uri: REDIRECT_URI, app_url: APP_URL }
  },

  async platform_set(me, b) {
    requireModerator(me)
    if (typeof b.google_client_id === 'string') await setSetting('google_client_id', b.google_client_id.trim())
    if (typeof b.google_client_secret === 'string' && b.google_client_secret.trim()) {
      await setSetting('google_client_secret', await encrypt(b.google_client_secret.trim()))
    }
    return { ok: true }
  },

  // ───────── Google: poczta + kalendarz ─────────
  async google_status() {
    return { configured: !!(await googleClient()) }
  },

  async google_start(me, b) {
    await requireMember(me, b.company_id)
    const client = await googleClient()
    if (!client) throw new HttpError(409, 'google_not_configured')
    const state = randomToken(20)
    // возвращаем только на свой домен или на локальную разработку
    const origin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(String(b.origin ?? '')) ? String(b.origin) : APP_URL
    const returnTo = /^\/app(\/|$)/.test(String(b.return_to ?? '')) ? `${origin}${b.return_to}` : `${origin}/app`
    await db.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
    await db.from('oauth_states').insert({ state, user_id: me.id, company_id: b.company_id, return_to: returnTo })
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: client.id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: me.email,
      state,
    }).toString()
    return { url: url.toString() }
  },

  async google_disconnect(me, b) {
    const { data: integ } = await db.from('integrations').select('id').eq('user_id', me.id).eq('company_id', b.company_id).eq('provider', 'google').maybeSingle()
    if (integ) await db.from('integrations').delete().eq('id', integ.id)
    return { ok: true }
  },

  async sync_now(me, b) {
    const { data: integ } = await db.from('integrations').select('id').eq('user_id', me.id).eq('company_id', b.company_id).eq('provider', 'google').maybeSingle()
    if (!integ) throw new HttpError(404, 'not_connected')
    EdgeRuntime.waitUntil(syncIntegration(integ.id, 4))
    return { started: true }
  },

  // ───────── Claude (MCP) ─────────
  async mcp_token_create(me, b) {
    await requireMember(me, b.company_id)
    const token = `aur_${randomToken(24)}`
    const { data, error } = await db.from('mcp_tokens').insert({
      user_id: me.id,
      company_id: b.company_id,
      name: String(b.name ?? 'Claude').slice(0, 60),
      token_hash: await sha256(token),
      preview: `${token.slice(0, 8)}…${token.slice(-4)}`,
    }).select('id, name, preview, created_at').single()
    if (error) throw new HttpError(400, error.message)
    return { token, row: data, url: `${FUNCTIONS_URL}/mcp/${token}`, base_url: `${FUNCTIONS_URL}/mcp` }
  },

  async mcp_token_revoke(me, b) {
    await db.from('mcp_tokens').delete().eq('id', b.id).eq('user_id', me.id)
    return { ok: true }
  },

  // ───────── baza wiedzy ─────────
  async embed(me, b) {
    const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 50)
    if (!ids.length) return { ok: true }
    const { data } = await db.from('entries').select('id, company_id').in('id', ids)
    const allowed: string[] = []
    for (const company of new Set((data ?? []).map((e) => e.company_id))) {
      await requireMember(me, company)
      allowed.push(...(data ?? []).filter((e) => e.company_id === company).map((e) => e.id))
    }
    await embedEntries(allowed)
    return { ok: true }
  },

  async import_text(me, b) {
    await requireMember(me, b.company_id)
    const text = String(b.text ?? '')
    if (text.trim().length < 40) throw new HttpError(400, 'text_too_short')
    let hint: string | null = null
    if (b.product_id) {
      const { data: p } = await db.from('products').select('name').eq('id', b.product_id).eq('company_id', b.company_id).maybeSingle()
      hint = p?.name ?? null
    }
    const chunks: string[] = []
    for (let i = 0; i < text.length && chunks.length < 4; i += 8000) chunks.push(text.slice(i, i + 8500))
    const total = { applied: 0, proposed: 0, skipped: 0, titles: [] as string[] }
    for (const chunk of chunks) {
      const res = await ingestText({
        companyId: b.company_id, source: 'file', label: String(b.label ?? 'Импорт текста').slice(0, 120),
        sourceUser: me.id, text: chunk, bootstrap: true, trusted: true, productHint: hint,
      })
      total.applied += res.applied
      total.proposed += res.proposed
      total.skipped += res.skipped
      total.titles.push(...res.titles)
    }
    return total
  },

  async extract_file(me, b) {
    const { data: file } = await db.from('files').select('*').eq('id', b.file_id).single()
    if (!file) throw new HttpError(404, 'not_found')
    await requireMember(me, file.company_id)
    const { data: blob, error } = await db.storage.from('media').download(file.path)
    if (error || !blob) throw new HttpError(400, 'download_failed')
    const name = String(file.name).toLowerCase()
    let text = ''
    if (name.endsWith('.pdf') || file.mime === 'application/pdf') {
      const { extractText, getDocumentProxy } = await import('npm:unpdf@0.12.1')
      const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()))
      const out = await extractText(pdf, { mergePages: true })
      text = Array.isArray(out.text) ? out.text.join('\n') : out.text
    } else if (name.endsWith('.docx')) {
      const { unzipSync, strFromU8 } = await import('npm:fflate@0.8.2')
      const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()))
      const xml = zip['word/document.xml'] ? strFromU8(zip['word/document.xml']) : ''
      text = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    } else if (/\.(txt|md|csv|json)$/.test(name) || (file.mime ?? '').startsWith('text/')) {
      text = await blob.text()
      if (name.endsWith('.html')) text = stripHtml(text)
    } else if (name.endsWith('.html') || name.endsWith('.htm')) {
      text = stripHtml(await blob.text())
    } else throw new HttpError(400, 'unsupported_file')
    if (text.trim().length < 40) throw new HttpError(400, 'no_text_in_file')
    return actions.import_text(me, { company_id: file.company_id, text, label: file.name, product_id: file.product_id })
  },

  async import_site(me, b) {
    await requireAdmin(me, b.company_id)
    let url: string
    try {
      url = safeUrl(String(b.url ?? '')).toString()
    } catch {
      throw new HttpError(400, 'bad_url')
    }
    const { data: src, error } = await db.from('web_sources').upsert(
      { company_id: b.company_id, url, status: 'queued', created_by: me.id, last_error: null },
      { onConflict: 'company_id,url' },
    ).select('id').single()
    if (error) throw new HttpError(400, error.message)
    await db.from('companies').update({ website: url }).eq('id', b.company_id).is('website', null)
    EdgeRuntime.waitUntil((async () => {
      await startCrawl(src.id)
      await crawlStep(src.id, 3)
    })())
    return { id: src.id }
  },

  async remove_site(me, b) {
    await requireAdmin(me, b.company_id)
    await db.from('web_sources').delete().eq('id', b.id).eq('company_id', b.company_id)
    return { ok: true }
  },

  async proposal_apply(me, b) {
    const { data: p } = await db.from('proposals').select('company_id, source_user').eq('id', b.id).single()
    if (!p) throw new HttpError(404, 'not_found')
    const role = await requireMember(me, p.company_id)
    if (role === 'member' && p.source_user !== me.id) throw new HttpError(403, 'forbidden')
    const entryId = await applyProposal(b.id, me.id, b.edits)
    return { entry_id: entryId }
  },

  async proposal_reject(me, b) {
    const { data: p } = await db.from('proposals').select('company_id, source_user, entry_id, kind').eq('id', b.id).single()
    if (!p) throw new HttpError(404, 'not_found')
    const role = await requireMember(me, p.company_id)
    if (role === 'member' && p.source_user !== me.id) throw new HttpError(403, 'forbidden')
    await db.from('proposals').update({ status: 'rejected', resolved_by: me.id, resolved_at: new Date().toISOString() }).eq('id', b.id)
    // «оставить как в базе» при конфликте = человек подтвердил старую версию
    if (p.entry_id) await db.from('entries').update({ verified_at: new Date().toISOString() }).eq('id', p.entry_id)
    return { ok: true }
  },

  async digest_now(me, b) {
    await requireAdmin(me, b.company_id)
    return { content: await generateDigest(b.company_id, true) }
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const me = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body
    const action = actions[String(body.action ?? '')]
    if (!action) throw new HttpError(400, 'unknown_action')
    return json(await action(me, body))
  } catch (e) {
    return fail(e)
  }
})
