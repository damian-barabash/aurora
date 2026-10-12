// Publikacje w LinkedIn i Instagramie przez Unipile: podłączanie kont bez duplikatów, dostęp, kolejka postów.

import { chat } from './ai.ts'
import { APP_URL, db, decrypt, encrypt, FUNCTIONS_URL, getSetting, HttpError, type Me, randomToken, requireMember, setSetting } from './core.ts'

// deno-lint-ignore no-explicit-any
type Any = any
// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<any>): void }

const DSN = (Deno.env.get('UNIPILE_DSN') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
const KEY = Deno.env.get('UNIPILE_KEY') ?? ''
const BASE = `https://${DSN}/api/v1`
export const socialReady = () => !!(DSN && KEY)

type Provider = 'linkedin' | 'instagram' | 'facebook'
interface Media { path: string; mime: string; name: string; size: number }

async function uni(path: string, init: RequestInit = {}, timeout = 25_000): Promise<Any> {
  if (!socialReady()) throw new HttpError(409, 'social_not_configured')
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      'X-API-KEY': KEY,
      accept: 'application/json',
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeout),
  })
  const text = await r.text()
  let data: Any = null
  try { data = JSON.parse(text) } catch { /* odpowiedź bez JSON */ }
  if (!r.ok) throw new Error(String(data?.detail || data?.title || data?.type || text || `HTTP ${r.status}`).slice(0, 300))
  return data
}

async function listUnipile(): Promise<Any[]> {
  const out: Any[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const d = await uni(`/accounts?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    out.push(...(d.items ?? []))
    cursor = d.cursor ?? null
    if (!cursor) break
  }
  return out
}

const providerOf = (a: Any): Exclude<Provider, 'facebook'> | null => (a?.type === 'LINKEDIN' ? 'linkedin' : a?.type === 'INSTAGRAM' ? 'instagram' : null)
const networkId = (a: Any): string | null => a?.connection_params?.im?.id ? String(a.connection_params.im.id) : null

function statusOf(a: Any): 'ok' | 'credentials' | 'error' {
  const states: string[] = (a?.sources ?? []).map((s: Any) => s.status)
  if (states.includes('CREDENTIALS')) return 'credentials'
  if (states.some((s) => s === 'ERROR' || s === 'STOPPED' || s === 'PERMISSIONS')) return 'error'
  return 'ok'
}

const describe = (a: Any) => ({
  name: String(a.name ?? a.connection_params?.im?.username ?? ''),
  handle: a.connection_params?.im?.publicIdentifier ?? null,
  organizations: (a.connection_params?.im?.organizations ?? [])
    .filter((o: Any) => o.organization_urn)
    .map((o: Any) => ({ urn: o.organization_urn, name: o.name })),
  status: statusOf(a),
  updated_at: new Date().toISOString(),
})

/**
 * Konto, na które ktoś właśnie się zalogował. Jeśli to samo konto sieci już jest w Unipile, świeża kopia jest usuwana,
 * a użytkownik zostaje współwłaścicielem istniejącego — zalogował się, więc ma do niego prawo.
 * Starszych kont nie ruszamy nigdy: z tej samej instancji Unipile korzystają inne projekty.
 */
export async function adoptAccount(unipileId: string, userId: string, companyId: string) {
  const fresh = await uni(`/accounts/${unipileId}`)
  const provider = providerOf(fresh)
  const pid = networkId(fresh)
  if (!provider || !pid) throw new Error('unsupported_account')

  let keep = fresh
  const { data: known } = await db.from('social_accounts').select('id').eq('unipile_id', fresh.id).maybeSingle()
  // Zgłoszenie przychodzi z zewnątrz, więc nie ufamy samemu identyfikatorowi: przyjmujemy tylko konto utworzone przed chwilą
  // (świeże logowanie) albo ponowne logowanie kogoś, kto już jest jego właścicielem. Dzięki temu nie da się ani przejąć,
  // ani usunąć starego konta, z którego korzysta inny projekt.
  if (known) {
    const { data: own } = await db.from('social_access').select('role').eq('account_id', known.id).eq('user_id', userId).eq('role', 'owner').limit(1)
    if (!own?.length) throw new Error('not_owner')
  } else if (!(Date.now() - new Date(fresh.created_at).getTime() < 20 * 60_000)) {
    throw new Error('not_fresh')
  }
  if (!known) {
    const twins = (await listUnipile())
      .filter((a) => a.id !== fresh.id && a.type === fresh.type && networkId(a) === pid && statusOf(a) === 'ok')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    if (twins.length) {
      keep = twins[0]
      await uni(`/accounts/${fresh.id}`, { method: 'DELETE' }).catch((e) => console.error('duplicate not removed', e))
    }
  }

  const { data: account, error } = await db.from('social_accounts')
    .upsert({ provider, provider_user_id: pid, unipile_id: keep.id, ...describe(keep) }, { onConflict: 'provider,provider_user_id' })
    .select('id').single()
  if (error) throw new Error(error.message)
  await db.from('social_access').upsert({ account_id: account.id, user_id: userId, company_id: companyId, role: 'owner', needs_approval: false, granted_by: null })
  return { account_id: account.id, duplicate: keep.id !== fresh.id }
}

/** Stan kont z Unipile: wygasłe logowanie zgłaszamy właścicielom, konta usunięte po stronie Unipile oznaczamy. */
export async function syncAccounts() {
  const { data: rows } = await db.from('social_accounts').select('id, unipile_id, status, name').neq('provider', 'facebook')
  if (!rows?.length || !socialReady()) return 0
  const live = new Map((await listUnipile()).map((a) => [a.id as string, a]))
  for (const row of rows) {
    const a = live.get(row.unipile_id)
    const patch = a ? describe(a) : { status: 'gone' as const, updated_at: new Date().toISOString() }
    await db.from('social_accounts').update(patch).eq('id', row.id)
    if (patch.status !== 'ok' && row.status === 'ok') {
      const { data: owners } = await db.from('social_access').select('user_id, company_id').eq('account_id', row.id).eq('role', 'owner')
      if (owners?.length) {
        await db.from('notifications').insert(owners.map((o) => ({
          user_id: o.user_id, company_id: o.company_id, type: 'social',
          title: `Konto „${row.name}” wymaga ponownego podłączenia`,
          body: 'Sieć wylogowała konto. Zaplanowane posty nie zostaną opublikowane, dopóki nie zalogujesz się ponownie.',
          link: '/app/social?tab=accounts',
        })))
      }
    }
  }
  return rows.length
}

// ───────── Facebook: własna aplikacja Meta ─────────

const GRAPH = 'https://graph.facebook.com/v23.0'
export const META_REDIRECT = FUNCTIONS_URL + '/social/meta'
// osobna konfiguracja logowania AURORA: tylko publikowanie, bez wiadomości i webhooków
const META_SCOPES = 'pages_show_list,pages_manage_posts,pages_read_engagement'

export async function metaClient(): Promise<{ id: string; secret: string; config: string | null } | null> {
  const [id, secret, config] = await Promise.all([getSetting('meta_app_id'), getSetting('meta_app_secret'), getSetting('meta_config_id')])
  if (!id || !secret) return null
  return { id, secret: await decrypt(secret), config: config || null }
}

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<Any> {
  const body = new URLSearchParams(params)
  const r = await fetch(method === 'GET' ? GRAPH + path + '?' + body : GRAPH + path, {
    method, ...(method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(120_000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw Object.assign(new Error(String(d.error?.error_user_msg || d.error?.message || 'Meta ' + r.status).slice(0, 300)), { code: d.error?.code })
  return d
}

async function metaLoginUrl(me: Me, b: Record<string, Any>): Promise<string> {
  const client = await metaClient()
  if (!client) throw new HttpError(409, 'facebook_not_configured')
  const origin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(String(b.origin ?? '')) ? String(b.origin) : APP_URL
  const state = 'fb_' + randomToken(20)
  await db.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
  await db.from('oauth_states').insert({ state, user_id: me.id, company_id: b.company_id, return_to: origin + '/app/social?tab=accounts' })
  const url = new URL('https://www.facebook.com/v23.0/dialog/oauth')
  url.search = new URLSearchParams({
    client_id: client.id, redirect_uri: META_REDIRECT, state, response_type: 'code',
    ...(client.config ? { config_id: client.config, override_default_response_type: 'true' } : { scope: META_SCOPES }),
  }).toString()
  return url.toString()
}

/** Powrót z Facebooka: każda strona, którą użytkownik wybrał w oknie Meta i na której może publikować, trafia na listę kont. */
export async function metaCallback(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const { data: st } = state.startsWith('fb_') ? await db.from('oauth_states').select('*').eq('state', state).maybeSingle() : { data: null }
  const back = (to: string, result: string) => Response.redirect(to + '&social=' + result, 302)
  if (!st) return back(APP_URL + '/app/social?tab=accounts', 'error')
  await db.from('oauth_states').delete().eq('state', state)
  try {
    const client = await metaClient()
    const code = url.searchParams.get('code')
    if (!client || !code) throw new Error(url.searchParams.get('error_description') ?? 'no_code')
    const short = await graph('/oauth/access_token', { client_id: client.id, client_secret: client.secret, redirect_uri: META_REDIRECT, code })
    // token użytkownika wymieniamy na długi: tokeny stron z niego nie wygasają
    const long = await graph('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: client.id, client_secret: client.secret, fb_exchange_token: short.access_token })
    const pages: Any[] = []
    let next: string | null = GRAPH + '/me/accounts?' + new URLSearchParams({ fields: 'id,name,access_token,tasks', limit: '100', access_token: long.access_token })
    while (next && pages.length < 300) {
      const d: Any = await (await fetch(next)).json()
      if (d.error) throw new Error(d.error.message)
      pages.push(...(d.data ?? []))
      next = d.paging?.next ?? null
    }
    // Strony z portfolio firmowego (Business Manager) nie pojawiają się w /me/accounts bez business_management.
    // Identyfikatory stron wybranych w oknie Meta są jednak w tokenie — dociągamy je pojedynczo.
    const dbg: Any = await graph('/debug_token', { input_token: long.access_token, access_token: client.id + '|' + client.secret }).catch(() => null)
    const picked: string[] = [...new Set<string>((dbg?.data?.granular_scopes ?? [])
      .filter((g: Any) => g.scope === 'pages_manage_posts' || g.scope === 'pages_show_list')
      .flatMap((g: Any) => (g.target_ids ?? []).map(String)))]
    for (const id of picked.filter((x) => !pages.some((p) => String(p.id) === x)).slice(0, 50)) {
      const p: Any = await graph('/' + id, { fields: 'id,name,access_token', access_token: long.access_token }).catch((e) => ({ id, name: '', error: String(e.message ?? e) }))
      pages.push(p)
    }
    const usable = pages.filter((p) => p.access_token && (!p.tasks || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE')))
    // co faktycznie przyznał użytkownik — bez tokenów; pozwala odróżnić „nie wybrano stron” od „brak uprawnienia”
    const perms: Any = await graph('/me/permissions', { access_token: long.access_token }).catch(() => ({ data: [] }))
    const granted: string[] = (perms.data ?? []).filter((x: Any) => x.status === 'granted').map((x: Any) => x.permission)
    await setSetting('meta_last_login', JSON.stringify({
      at: new Date().toISOString(), granted, picked: picked.length, pages: pages.map((p) => ({ name: p.name, tasks: p.tasks ?? null, token: !!p.access_token, error: p.error ?? null })),
    }))
    if (!granted.includes('pages_manage_posts')) return back(st.return_to, 'noperm')
    if (!usable.length) return back(st.return_to, 'nopages')
    for (const p of usable) {
      // ta sama strona u drugiej osoby = ten sam wiersz: druga osoba zostaje współwłaścicielem
      const { data: account, error } = await db.from('social_accounts').upsert({
        provider: 'facebook', provider_user_id: String(p.id), unipile_id: 'fb:' + p.id, name: String(p.name ?? ''),
        status: 'ok', secret: await encrypt(p.access_token), updated_at: new Date().toISOString(),
      }, { onConflict: 'provider,provider_user_id' }).select('id').single()
      if (error) throw new Error(error.message)
      await db.from('social_access').upsert({ account_id: account.id, user_id: st.user_id, company_id: st.company_id, role: 'owner', needs_approval: false, granted_by: null })
    }
    return back(st.return_to, 'connected')
  } catch (e) {
    console.error('meta callback', e)
    return back(st.return_to, 'error')
  }
}

async function publishFacebook(acc: Any, post: Any): Promise<string | null> {
  const token = await decrypt(acc.secret)
  const page = acc.provider_user_id
  const media = (post.media ?? []) as Media[]
  const text = String(post.text ?? '')
  // Meta pobiera pliki sama — dostaje adresy podpisane na godzinę
  const link = async (m: Media) => {
    const { data } = await db.storage.from('social').createSignedUrl(m.path, 3600)
    if (!data?.signedUrl) throw new Error('Nie udało się przygotować pliku ' + m.name)
    return data.signedUrl
  }
  try {
    const video = media.find((m) => m.mime.startsWith('video/'))
    if (video) return (await graph('/' + page + '/videos', { file_url: await link(video), description: text, access_token: token }, 'POST')).id ?? null
    if (!media.length) {
      const url = text.match(/https?:\/\/[^\s)]+/)?.[0]
      return (await graph('/' + page + '/feed', { message: text, ...(url ? { link: url } : {}), access_token: token }, 'POST')).id ?? null
    }
    if (media.length === 1) {
      const res = await graph('/' + page + '/photos', { url: await link(media[0]), caption: text, access_token: token }, 'POST')
      return res.post_id ?? res.id ?? null
    }
    const attached: Record<string, string> = {}
    for (const [i, m] of media.entries()) {
      const photo = await graph('/' + page + '/photos', { url: await link(m), published: 'false', access_token: token }, 'POST')
      attached['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: photo.id })
    }
    return (await graph('/' + page + '/feed', { message: text, ...attached, access_token: token }, 'POST')).id ?? null
  } catch (e) {
    // 190 = token unieważniony (zmiana hasła, cofnięty dostęp): konto trzeba podłączyć ponownie
    if ((e as Any)?.code === 190) await db.from('social_accounts').update({ status: 'credentials' }).eq('id', acc.id)
    throw e
  }
}

// ───────── publikacja ─────────

async function publishTarget(t: Any, post: Any, files: Map<string, Blob>) {
  try {
    const { data: acc } = t.account_id
      ? await db.from('social_accounts').select('*').eq('id', t.account_id).maybeSingle()
      : { data: null }
    if (!acc) throw new Error('Konto zostało odłączone')
    if (acc.status !== 'ok') throw new Error('Konto wymaga ponownego podłączenia')
    if (acc.provider === 'facebook') {
      const id = await publishFacebook(acc, post)
      await db.from('social_targets').update({
        status: 'published', provider_post_id: id, published_at: new Date().toISOString(), error: null, locked_at: null,
      }).eq('id', t.id)
      return
    }

    const form = new FormData()
    form.append('account_id', acc.unipile_id)
    form.append('text', post.text ?? '')
    for (const m of (post.media ?? []) as Media[]) {
      if (!files.has(m.path)) {
        const { data: blob, error } = await db.storage.from('social').download(m.path)
        if (error || !blob) throw new Error(`Nie udało się pobrać pliku ${m.name}`)
        files.set(m.path, blob)
      }
      form.append('attachments', new File([files.get(m.path)!], m.name, { type: m.mime }))
    }
    if (acc.provider === 'linkedin') {
      if (t.org_urn) form.append('as_organization', String(t.org_urn).split(':').pop()!)
      // post bez zdjęć: pierwszy link z tekstu dostaje kartę podglądu
      const link = !(post.media ?? []).length && String(post.text ?? '').match(/https?:\/\/[^\s)]+/)?.[0]
      if (link) form.append('external_link', link)
    } else {
      form.append('post_type', t.kind === 'story' ? 'story' : 'feed')
    }
    const res = await uni('/posts', { method: 'POST', body: form }, 140_000)
    await db.from('social_targets').update({
      status: 'published', provider_post_id: res?.post_id ?? null, published_at: new Date().toISOString(), error: null, locked_at: null,
    }).eq('id', t.id)
  } catch (e) {
    const message = e instanceof Error ? (e.name === 'TimeoutError' ? 'Sieć nie odpowiedziała na czas. Sprawdź profil, zanim ponowisz — post mógł się opublikować.' : e.message) : String(e)
    await db.from('social_targets').update({ status: 'failed', error: message.slice(0, 300), locked_at: null }).eq('id', t.id)
    if (post.author_id) {
      await db.from('notifications').insert({
        user_id: post.author_id, company_id: post.company_id, type: 'social',
        title: `Nie udało się opublikować: ${t.label}`, body: message.slice(0, 200), link: '/app/social?tab=queue',
      })
    }
  }
}

/** Wysyła wszystko, na co przyszła pora. Cel jest najpierw zajmowany w bazie, więc cron i „Opublikuj teraz” się nie zdublują. */
export async function runDue(postId: string | null = null, deadline = Date.now() + 130_000) {
  let sent = 0
  while (Date.now() < deadline - 20_000) {
    const { data: claimed } = await db.rpc('claim_social_targets', { p_post: postId, p_limit: 3 })
    if (!claimed?.length) break
    const posts = new Map<string, Any>()
    const files = new Map<string, Blob>()
    for (const t of claimed) {
      if (!posts.has(t.post_id)) {
        const { data } = await db.from('social_posts').select('*').eq('id', t.post_id).single()
        posts.set(t.post_id, data)
      }
      await publishTarget(t, posts.get(t.post_id), files)
      sent++
    }
  }
  return sent
}

/** Osoba straciła dostęp do konta: to, co zaplanowała i co jeszcze nie wyszło, nie może zostać opublikowane. */
async function cancelPending(accountId: string, userId: string) {
  const { data: posts } = await db.from('social_posts').select('id').eq('author_id', userId)
  if (!posts?.length) return
  await db.from('social_targets').update({ status: 'rejected', error: 'Autor nie ma już dostępu do tego konta' })
    .eq('account_id', accountId).in('status', ['approval', 'scheduled']).in('post_id', posts.map((p) => p.id))
}

/** Konto bez żadnego właściciela (usunięty użytkownik lub firma) znika razem z dostępami, które ten właściciel rozdał. */
export async function dropOrphans() {
  const [{ data: accounts }, { data: owners }] = await Promise.all([
    db.from('social_accounts').select('id'),
    db.from('social_access').select('account_id').eq('role', 'owner'),
  ])
  const owned = new Set((owners ?? []).map((o) => o.account_id))
  const orphans = (accounts ?? []).filter((a) => !owned.has(a.id)).map((a) => a.id)
  if (orphans.length) await db.from('social_accounts').delete().in('id', orphans)
  return orphans.length
}

/** Cel, który utknął w „publishing” (funkcja padła w trakcie), nie jest ponawiany sam — mógłby wyjść drugi raz. */
export async function failStuck() {
  await db.from('social_targets')
    .update({ status: 'failed', error: 'Publikacja została przerwana. Sprawdź profil, zanim spróbujesz ponownie.', locked_at: null })
    .eq('status', 'publishing').lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString())
}

// ───────── akcje panelu ─────────

type Body = Record<string, Any>

const myAccess = async (me: Me, companyId: string) =>
  (await db.from('social_access').select('*').eq('user_id', me.id).eq('company_id', companyId)).data ?? []

async function requireOwner(me: Me, companyId: string, accountId: string) {
  const { data } = await db.from('social_access').select('role')
    .eq('account_id', accountId).eq('user_id', me.id).eq('company_id', companyId).maybeSingle()
  if (data?.role !== 'owner') throw new HttpError(403, 'forbidden')
}

async function ownersOf(accountId: string): Promise<{ user_id: string; company_id: string }[]> {
  return (await db.from('social_access').select('user_id, company_id').eq('account_id', accountId).eq('role', 'owner')).data ?? []
}

const names = async (ids: string[]) => {
  if (!ids.length) return {} as Record<string, string>
  const { data } = await db.from('profiles').select('id, full_name, email').in('id', [...new Set(ids)])
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name || p.email]))
}

export const socialActions: Record<string, (me: Me, b: Body) => Promise<unknown>> = {
  async social_list(me, b) {
    await requireMember(me, b.company_id)
    const mine = await myAccess(me, b.company_id)
    const ids = mine.map((a) => a.account_id)
    const [{ data: accounts }, { data: access }, { data: moderators }] = await Promise.all([
      ids.length ? db.from('social_accounts').select('*').in('id', ids).order('created_at') : Promise.resolve({ data: [] as Any[] }),
      ids.length ? db.from('social_access').select('*').in('account_id', ids).order('created_at') : Promise.resolve({ data: [] as Any[] }),
      db.from('profiles').select('id, full_name, email').eq('is_moderator', true),
    ])
    const who = await names((access ?? []).map((a) => a.user_id))
    return {
      configured: socialReady(),
      facebook: !!(await metaClient()),
      moderators: (moderators ?? []).map((m) => ({ id: m.id, name: m.full_name || m.email })),
      accounts: (accounts ?? []).map((a) => {
        const own = mine.find((m) => m.account_id === a.id)!
        return {
          id: a.id, provider: a.provider, name: a.name, handle: a.handle, organizations: a.organizations, status: a.status,
          role: own.role, needs_approval: own.needs_approval,
          people: (access ?? []).filter((x) => x.account_id === a.id).map((x) => ({
            user_id: x.user_id, name: who[x.user_id] ?? '', role: x.role, needs_approval: x.needs_approval, company_id: x.company_id,
          })),
        }
      }),
    }
  },

  /** Link do strony logowania Unipile; hasło nigdy nie przechodzi przez AURORA. */
  async social_connect(me, b) {
    await requireMember(me, b.company_id)
    if (b.provider === 'facebook') return { url: await metaLoginUrl(me, b) }
    const provider = b.provider === 'instagram' ? 'INSTAGRAM' : 'LINKEDIN'
    let reconnect: string | null = null
    if (b.account_id) {
      await requireOwner(me, b.company_id, b.account_id)
      const { data: acc } = await db.from('social_accounts').select('unipile_id, status').eq('id', b.account_id).single()
      if (acc && acc.status !== 'gone') reconnect = acc.unipile_id
    }
    const origin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(String(b.origin ?? '')) ? String(b.origin) : APP_URL
    const back = `${origin}/app/social?tab=accounts`
    const state = `soc_${randomToken(20)}`
    await db.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
    await db.from('oauth_states').insert({ state, user_id: me.id, company_id: b.company_id, return_to: back })
    const link = await uni('/hosted/accounts/link', {
      method: 'POST',
      body: JSON.stringify({
        type: reconnect ? 'reconnect' : 'create',
        ...(reconnect ? { reconnect_account: reconnect } : {}),
        providers: [provider],
        api_url: `https://${DSN}`,
        expiresOn: new Date(Date.now() + 30 * 60_000).toISOString(),
        name: state,
        notify_url: `${FUNCTIONS_URL}/social/notify`,
        success_redirect_url: `${back}&social=connected`,
        failure_redirect_url: `${back}&social=error`,
      }),
    })
    return { url: link.url }
  },

  /** Odłącza konto tylko w AURORA. W Unipile zostaje — mogą z niego korzystać inne projekty. */
  async social_disconnect(me, b) {
    await db.from('social_access').delete().eq('account_id', b.account_id).eq('user_id', me.id).eq('company_id', b.company_id)
    const { count } = await db.from('social_access').select('user_id', { count: 'exact', head: true }).eq('account_id', b.account_id).eq('user_id', me.id)
    if (!count) await cancelPending(b.account_id, me.id)
    if (!(await ownersOf(b.account_id)).length) await db.from('social_accounts').delete().eq('id', b.account_id)
    return { ok: true }
  },

  async social_grant(me, b) {
    await requireOwner(me, b.company_id, b.account_id)
    const [{ data: member }, { data: target }] = await Promise.all([
      db.from('company_members').select('user_id').eq('company_id', b.company_id).eq('user_id', b.user_id).maybeSingle(),
      db.from('profiles').select('id, is_moderator').eq('id', b.user_id).maybeSingle(),
    ])
    if (!target || (!member && !target.is_moderator)) throw new HttpError(403, 'not_in_company')
    const { data: cur } = await db.from('social_access').select('role')
      .eq('account_id', b.account_id).eq('user_id', b.user_id).eq('company_id', b.company_id).maybeSingle()
    if (cur?.role === 'owner') return { ok: true }
    const { error } = await db.from('social_access').upsert({
      account_id: b.account_id, user_id: b.user_id, company_id: b.company_id,
      role: 'publisher', needs_approval: !!b.needs_approval, granted_by: me.id,
    })
    if (error) throw new HttpError(400, error.message)
    if (!cur) {
      const { data: acc } = await db.from('social_accounts').select('name').eq('id', b.account_id).single()
      await db.from('notifications').insert({
        user_id: b.user_id, company_id: b.company_id, type: 'social',
        title: `Masz dostęp do konta „${acc?.name ?? ''}”`,
        body: b.needs_approval ? 'Twoje posty opublikuje właściciel konta po akceptacji.' : 'Możesz publikować samodzielnie.',
        link: '/app/social',
      })
    }
    return { ok: true }
  },

  async social_revoke(me, b) {
    await requireOwner(me, b.company_id, b.account_id)
    await db.from('social_access').delete()
      .eq('account_id', b.account_id).eq('user_id', b.user_id).eq('company_id', b.company_id).eq('role', 'publisher')
    const { count } = await db.from('social_access').select('user_id', { count: 'exact', head: true }).eq('account_id', b.account_id).eq('user_id', b.user_id)
    if (!count) await cancelPending(b.account_id, b.user_id)
    return { ok: true }
  },

  async social_publish(me, b) {
    await requireMember(me, b.company_id)
    const text = String(b.text ?? '').trim()
    const media: Media[] = (Array.isArray(b.media) ? b.media : []).slice(0, 10)
      .filter((m: Any) => typeof m?.path === 'string' && m.path.startsWith(`${b.company_id}/`))
      .map((m: Any) => ({ path: m.path, mime: String(m.mime ?? ''), name: String(m.name ?? 'plik').slice(0, 120), size: Number(m.size) || 0 }))
    const wanted: Any[] = Array.isArray(b.targets) ? b.targets.slice(0, 20) : []
    if (!wanted.length) throw new HttpError(400, 'no_targets')
    if (!text && !media.length) throw new HttpError(400, 'empty_post')

    let due = new Date()
    if (b.scheduled_at) {
      const at = new Date(String(b.scheduled_at))
      if (Number.isNaN(at.getTime())) throw new HttpError(400, 'bad_date')
      if (at.getTime() > Date.now() + 366 * 86400_000) throw new HttpError(400, 'bad_date')
      if (at.getTime() > Date.now()) due = at
    }
    const later = due.getTime() > Date.now() + 30_000

    const access = new Map((await myAccess(me, b.company_id)).map((a) => [a.account_id as string, a]))
    const { data: accounts } = await db.from('social_accounts').select('*').in('id', [...access.keys()])
    const rows: Any[] = []
    for (const w of wanted) {
      const acc = (accounts ?? []).find((a) => a.id === w.account_id)
      const own = access.get(w.account_id)
      if (!acc || !own) throw new HttpError(403, 'forbidden')
      if (acc.status !== 'ok') throw new HttpError(409, 'account_needs_reconnect')
      const org = w.org_urn ? (acc.organizations as Any[]).find((o) => o.urn === w.org_urn) : null
      if (w.org_urn && !org) throw new HttpError(400, 'unknown_page')
      const kind = acc.provider === 'instagram' && w.kind === 'story' ? 'story' : 'feed'
      if (acc.provider === 'instagram' && !media.length) throw new HttpError(400, 'instagram_needs_media')
      if (kind === 'story' && media.length !== 1) throw new HttpError(400, 'story_one_file')
      rows.push({
        account_id: acc.id, provider: acc.provider, label: org ? org.name : acc.name, org_urn: org?.urn ?? null, kind,
        status: own.needs_approval ? 'approval' : 'scheduled', due_at: due.toISOString(),
      })
    }

    const { data: post, error } = await db.from('social_posts').insert({
      company_id: b.company_id, author_id: me.id, text, media, scheduled_at: later ? due.toISOString() : null,
    }).select('id').single()
    if (error) throw new HttpError(400, error.message)
    await db.from('social_targets').insert(rows.map((r) => ({ ...r, post_id: post.id })))

    const waiting = rows.filter((r) => r.status === 'approval')
    for (const accountId of new Set(waiting.map((r) => r.account_id))) {
      const owners = await ownersOf(accountId)
      if (owners.length) {
        await db.from('notifications').insert(owners.map((o) => ({
          user_id: o.user_id, company_id: o.company_id, type: 'social',
          title: `${me.full_name || me.email} prosi o akceptację posta`,
          body: text.slice(0, 160), link: '/app/social?tab=queue',
        })))
      }
    }
    if (!later && waiting.length < rows.length) EdgeRuntime.waitUntil(runDue(post.id))
    return { post_id: post.id, approval: waiting.length, scheduled: later }
  },

  async social_posts(me, b) {
    await requireMember(me, b.company_id)
    const { data: posts } = await db.from('social_posts').select('*, targets:social_targets(*)')
      .eq('company_id', b.company_id).order('created_at', { ascending: false }).limit(60)
    const list = posts ?? []
    const owned = new Set((await myAccess(me, b.company_id)).filter((a) => a.role === 'owner').map((a) => a.account_id))
    const who = await names(list.map((p) => p.author_id).filter(Boolean))
    const paths = [...new Set(list.flatMap((p) => (p.media as Media[]).map((m) => m.path)))]
    const { data: signed } = paths.length ? await db.storage.from('social').createSignedUrls(paths, 3600) : { data: [] as Any[] }
    const urls = Object.fromEntries((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]))
    return {
      posts: list.map((p) => ({
        id: p.id, text: p.text, scheduled_at: p.scheduled_at, created_at: p.created_at,
        author: p.author_id ? who[p.author_id] ?? '' : '', mine: p.author_id === me.id,
        media: (p.media as Media[]).map((m) => ({ ...m, url: urls[m.path] ?? null })),
        targets: (p.targets as Any[]).map((t) => ({
          id: t.id, provider: t.provider, label: t.label, kind: t.kind, status: t.status, due_at: t.due_at,
          error: t.error, published_at: t.published_at, can_decide: !!t.account_id && owned.has(t.account_id),
        })),
      })),
    }
  },

  /** Właściciel konta akceptuje albo odrzuca post osoby, która publikuje za jego zgodą. */
  async social_decide(me, b) {
    const { data: t } = await db.from('social_targets').select('*, post:social_posts(company_id, author_id, text)').eq('id', b.target_id).single()
    if (!t || t.status !== 'approval') throw new HttpError(404, 'not_found')
    const { data: own } = await db.from('social_access').select('role').eq('account_id', t.account_id).eq('user_id', me.id).eq('role', 'owner').limit(1)
    if (!own?.length) throw new HttpError(403, 'forbidden')
    await db.from('social_targets').update({ status: b.approve ? 'scheduled' : 'rejected', decided_by: me.id }).eq('id', t.id).eq('status', 'approval')
    if (t.post.author_id) {
      await db.from('notifications').insert({
        user_id: t.post.author_id, company_id: t.post.company_id, type: 'social',
        title: b.approve ? `Post zaakceptowany: ${t.label}` : `Post odrzucony: ${t.label}`,
        body: String(t.post.text).slice(0, 160), link: '/app/social?tab=queue',
      })
    }
    if (b.approve && new Date(t.due_at).getTime() <= Date.now()) EdgeRuntime.waitUntil(runDue(t.post_id))
    return { ok: true }
  },

  async social_retry(me, b) {
    const { data: t } = await db.from('social_targets').select('id, status, account_id, post_id, post:social_posts(company_id, author_id)').eq('id', b.target_id).single()
    if (!t || t.status !== 'failed') throw new HttpError(404, 'not_found')
    const post = t.post as Any
    await requireMember(me, post.company_id)
    const access = (await myAccess(me, post.company_id)).find((a) => a.account_id === t.account_id)
    if (!access || (post.author_id !== me.id && access.role !== 'owner')) throw new HttpError(403, 'forbidden')
    await db.from('social_targets').update({ status: 'scheduled', due_at: new Date().toISOString(), error: null }).eq('id', t.id).eq('status', 'failed')
    EdgeRuntime.waitUntil(runDue(t.post_id))
    return { ok: true }
  },

  /** Usuwa post z AURORA (i anuluje to, co jeszcze nie wyszło). To, co już opublikowane, w sieciach zostaje. */
  async social_delete_post(me, b) {
    const { data: post } = await db.from('social_posts').select('id, company_id, author_id, media, targets:social_targets(status)').eq('id', b.post_id).single()
    if (!post) throw new HttpError(404, 'not_found')
    const role = await requireMember(me, post.company_id)
    if (post.author_id !== me.id && role === 'member') throw new HttpError(403, 'forbidden')
    if ((post.targets as Any[]).some((t) => t.status === 'publishing')) throw new HttpError(409, 'publishing_now')
    const paths = (post.media as Media[]).map((m) => m.path)
    await db.from('social_posts').delete().eq('id', post.id)
    if (paths.length) await db.storage.from('social').remove(paths)
    return { ok: true }
  },

  /** Szkic posta z faktów w bazie i tonu marki. */
  async social_draft(me, b) {
    await requireMember(me, b.company_id)
    const brief = String(b.brief ?? '').trim().slice(0, 600)
    if (!b.product_id && brief.length < 5) throw new HttpError(400, 'brief_required')
    const [{ data: company }, { data: brand }, { data: product }, { data: entries }] = await Promise.all([
      db.from('companies').select('name').eq('id', b.company_id).single(),
      db.from('brand').select('tagline, audience, tone, dos, donts').eq('company_id', b.company_id).maybeSingle(),
      b.product_id
        ? db.from('products').select('name, description').eq('id', b.product_id).eq('company_id', b.company_id).maybeSingle()
        : Promise.resolve({ data: null as Any }),
      b.product_id
        ? db.from('entries').select('type, title, body, effective_from').eq('company_id', b.company_id).eq('product_id', b.product_id)
          .eq('status', 'current').order('updated_at', { ascending: false }).limit(25)
        : Promise.resolve({ data: [] as Any[] }),
    ])
    const facts = (entries ?? []).map((e) => `- [${e.type}${e.effective_from ? ` ${e.effective_from}` : ''}] ${e.title}: ${String(e.body).slice(0, 400)}`).join('\n')
    const system = [
      `Piszesz post do mediów społecznościowych firmy ${company?.name ?? ''} — po polsku.`,
      'Korzystaj wyłącznie z faktów podanych niżej: nie wymyślaj cen, dat ani obietnic. Jeśli faktu brakuje, pomiń go.',
      'Jeden post, do 900 znaków: mocne pierwsze zdanie, konkret, wezwanie do działania, na końcu 3–5 hashtagów.',
      'Bez nagłówków, bez markdownu, bez cudzysłowów wokół całości. Oddaj sam tekst posta.',
      brand?.tone ? `Ton marki: ${brand.tone}` : '',
      brand?.audience ? `Odbiorcy: ${brand.audience}` : '',
      brand?.dos ? `Tak piszemy: ${brand.dos}` : '',
      brand?.donts ? `Tak nie piszemy: ${brand.donts}` : '',
    ].filter(Boolean).join('\n')
    const user = [
      product ? `Produkt: ${product.name}${product.description ? ` — ${product.description}` : ''}` : '',
      facts ? `Fakty z bazy:\n${facts}` : '',
      brief ? `O czym ma być post: ${brief}` : '',
      `Dzisiejsza data: ${new Date().toISOString().slice(0, 10)}`,
    ].filter(Boolean).join('\n\n')
    const text = (await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.6, maxTokens: 700 })).trim()
    if (!text) throw new HttpError(502, 'ai_empty')
    return { text }
  },
}
