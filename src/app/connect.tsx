import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, copyText, IconBtn, Segmented, useFeedback } from '../components/ui'
import { fmtWhen, useI18n, useT } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'
import type { Integration } from '../lib/types'
import { useChanged } from './Shell'
import { useSession } from './session'

export interface McpToken {
  id: string
  name: string
  preview: string
  last_used_at: string | null
  calls: number
  created_at: string
}

/** Состояние личных подключений текущего пользователя в текущей фирме. */
export function useConnections() {
  const { company, profile } = useSession()
  const [google, setGoogle] = useState<Integration | null>(null)
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [configured, setConfigured] = useState(true)
  const [ready, setReady] = useState(false)
  const reload = useCallback(async () => {
    if (!company || !profile) return
    const [{ data: integ }, { data: toks }, status] = await Promise.all([
      supabase.from('integrations').select('*').eq('company_id', company.id).eq('user_id', profile.id).eq('provider', 'google').maybeSingle(),
      supabase.from('mcp_tokens').select('id, name, preview, last_used_at, calls, created_at').eq('company_id', company.id).eq('user_id', profile.id).order('created_at'),
      api<{ configured: boolean }>('google_status').catch(() => ({ configured: false })),
    ])
    setGoogle(integ as Integration | null)
    setTokens((toks ?? []) as McpToken[])
    setConfigured(status.configured)
    setReady(true)
  }, [company, profile])
  useEffect(() => { reload() }, [reload])
  useChanged(reload)
  return { google, tokens, configured, ready, reload }
}

/** Один клик: уходим на экран согласия Google и возвращаемся на ту же страницу. */
export function useGoogleConnect() {
  const { company } = useSession()
  const { fail } = useFeedback()
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    if (!company) return
    setBusy(true)
    try {
      const { url } = await api<{ url: string }>('google_start', {
        company_id: company.id, return_to: location.pathname, origin: location.origin,
      })
      location.href = url
    } catch (e) {
      fail(e)
      setBusy(false)
    }
  }
  return { connect, busy }
}

export function CodeLine({ text }: { text: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <div className="code">
      {text}
      <IconBtn label={t('Скопировать', 'Kopiuj')} onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        }
      }}>{done ? <Check size={16} /> : <Copy size={16} />}</IconBtn>
    </div>
  )
}

/** Пошаговое подключение Claude: создаём личную ссылку и показываем, куда её вставить. */
export function ClaudeSetup({ tokens, onChange, compact }: { tokens: McpToken[]; onChange(): void; compact?: boolean }) {
  const t = useT()
  const { lang } = useI18n()
  const { company } = useSession()
  const { fail, confirm } = useFeedback()
  const [fresh, setFresh] = useState<{ url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [where, setWhere] = useState<'app' | 'code'>('app')

  const create = async () => {
    if (!company) return
    setBusy(true)
    try {
      const res = await api<{ url: string }>('mcp_token_create', { company_id: company.id, name: 'Claude' })
      setFresh(res)
      onChange()
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  const revoke = async (id: string) => {
    if (!(await confirm({ title: t('Отключить эту ссылку?', 'Odłączyć ten link?'), text: t('Claude с этой ссылкой потеряет доступ к базе знаний.', 'Claude z tym linkiem straci dostęp do bazy wiedzy.'), action: t('Отключить', 'Odłącz'), danger: true }))) return
    await api('mcp_token_revoke', { id }).catch(fail)
    onChange()
  }

  return (
    <div className="claude">
      {!fresh && (
        <div className="claude__start">
          <Button variant={tokens.length ? 'ghost' : 'primary'} icon={<Plus size={18} />} busy={busy} onClick={create}>
            {tokens.length ? t('Создать ещё одну ссылку', 'Utwórz kolejny link') : t('Создать личную ссылку', 'Utwórz osobisty link')}
          </Button>
          {!tokens.length && <p className="muted">{t('Ссылка привязана к вам и к этой фирме. Claude увидит только базу знаний — не почту.', 'Link jest przypisany do Ciebie i tej firmy. Claude zobaczy tylko bazę wiedzy — nie pocztę.')}</p>}
        </div>
      )}

      {fresh && (
        <ol className="steps">
          <li>
            <b>{t('Скопируйте личную ссылку', 'Skopiuj osobisty link')}</b>
            <span>{t('Она показывается один раз. Не делитесь ею — это ваш ключ.', 'Jest widoczny tylko raz. Nie udostępniaj go — to Twój klucz.')}</span>
            <CodeLine text={fresh.url} />
          </li>
          <li>
            <b>{t('Добавьте её в Claude', 'Dodaj go w Claude')}</b>
            <Segmented value={where} onChange={setWhere} options={[
              { value: 'app', label: 'Claude · claude.ai / Desktop' },
              { value: 'code', label: 'Claude Code' },
            ]} />
            {where === 'app' ? (
              <span>
                {t('Откройте', 'Otwórz')} <b>Settings → Connectors → Add custom connector</b>. {t('Название', 'Nazwa')}: <b>AURORA</b>, {t('адрес — ваша ссылка. Нажмите', 'adres — Twój link. Kliknij')} <b>Add</b>.
              </span>
            ) : (
              <>
                <span>{t('Выполните в терминале:', 'Uruchom w terminalu:')}</span>
                <CodeLine text={`claude mcp add --transport http aurora ${fresh.url}`} />
              </>
            )}
          </li>
          <li>
            <b>{t('Проверьте', 'Sprawdź')}</b>
            <span>{t('Спросите Claude: «Что нового в AURORA?». Когда он узнает новую информацию о продуктах, он сам спросит, обновить ли её в базе.', 'Zapytaj Claude: „Co nowego w AURORA?”. Gdy pozna nową informację o produktach, sam zapyta, czy zaktualizować ją w bazie.')}</span>
          </li>
        </ol>
      )}

      {!compact && tokens.length > 0 && (
        <div className="tokens">
          {tokens.map((tok) => (
            <div key={tok.id} className="tokens__row">
              <code>{tok.preview}</code>
              <span className="muted grow">
                {tok.last_used_at
                  ? `${t('использована', 'użyty')} ${fmtWhen(tok.last_used_at, lang)} · ${tok.calls} ${t('запросов', 'zapytań')}`
                  : t('ещё не использовалась', 'jeszcze nie użyty')}
              </span>
              <IconBtn label={t('Отключить', 'Odłącz')} onClick={() => revoke(tok.id)}><Trash2 size={16} /></IconBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
