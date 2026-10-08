import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../app/session'
import { Pattern, Wordmark } from '../brand/Logo'
import { Button, Field } from '../components/ui'
import { useI18n, useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import '../styles/landing.css'

export default function Login() {
  const t = useT()
  const { lang, setLang } = useI18n()
  const { session, loading } = useSession()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/app') ? params.get('next')! : '/app'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && session) nav(next, { replace: true })
  }, [loading, session, nav, next])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (err) setError(t('Неверная почта или пароль', 'Nieprawidłowy e-mail lub hasło'))
  }

  return (
    <div className="login">
      <div className="login__form">
        <div className="login__top">
          <Link to="/" aria-label="AURORA"><Wordmark size={22} /></Link>
          <button type="button" className="lp-nav__lang" onClick={() => setLang(lang === 'ru' ? 'pl' : 'ru')}>{lang === 'ru' ? 'PL' : 'RU'}</button>
        </div>
        <form onSubmit={submit} className="form login__box">
          <div>
            <h1>{t('Вход в AURORA', 'Logowanie do AURORA')}</h1>
            <p className="muted">{t('Штаб знаний вашей фирмы.', 'Sztab wiedzy Twojej firmy.')}</p>
          </div>
          <Field label="E-mail"><input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t('Пароль', 'Hasło')}><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p className="login__error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" size="lg" block busy={busy} trailing={<ArrowUpRight size={19} />}>{t('Войти', 'Zaloguj się')}</Button>
          <p className="login__note">{t('Регистрации пока нет. Аккаунт создаёт администратор вашей фирмы.', 'Rejestracji na razie nie ma. Konto tworzy administrator Twojej firmy.')}</p>
        </form>
        <span className="muted login__foot">AURORA © 2026</span>
      </div>
      <div className="login__art" aria-hidden>
        <Pattern />
        <div className="login__quote">
          <b>{t('Всё о продуктах фирмы. В одном месте. Всегда актуально.', 'Wszystko o produktach firmy. W jednym miejscu. Zawsze aktualne.')}</b>
          <span>A continuous line. A distinct signature.</span>
        </div>
      </div>
    </div>
  )
}
