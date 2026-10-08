import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '../app/session'
import { Pattern, Wordmark } from '../brand/Logo'
import { Button, Field } from '../components/ui'
import { supabase } from '../lib/supabase'
import '../styles/landing.css'

export default function Login() {
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
    if (err) setError('Nieprawidłowy e-mail lub hasło')
  }

  return (
    <div className="login">
      <div className="login__form">
        <div className="login__top">
          <Link to="/" aria-label="AURORA"><Wordmark size={22} /></Link>
        </div>
        <form onSubmit={submit} className="form login__box">
          <div>
            <h1>Logowanie do AURORA</h1>
            <p className="muted">Sztab wiedzy Twojej firmy.</p>
          </div>
          <Field label="E-mail"><input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Hasło"><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p className="login__error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" size="lg" block busy={busy} trailing={<ArrowUpRight size={19} />}>Zaloguj się</Button>
          <p className="login__note">Rejestracji na razie nie ma. Konto tworzy administrator Twojej firmy.</p>
        </form>
        <span className="muted login__foot">AURORA © 2026</span>
      </div>
      <div className="login__art" aria-hidden>
        <Pattern />
        <div className="login__quote">
          <b>Wszystko o produktach firmy. W jednym miejscu. Zawsze aktualne.</b>
          <span>A continuous line. A distinct signature.</span>
        </div>
      </div>
    </div>
  )
}
