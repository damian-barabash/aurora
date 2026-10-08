import { Calendar, Check, EyeOff, Lock, Mail, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AppIcon } from '../brand/Logo'
import { Button, cx, IconBtn } from '../components/ui'
import { ClaudeSetup, useConnections, useGoogleConnect } from './connect'
import { useSession } from './session'

const WEEK = 7 * 86400000

/**
 * «Быстрый старт»: при входе в панель предлагает подключить почту (1 клик) и затем Claude.
 * Крестик не прячет окно навсегда — оно улетает в левый нижний угол и живёт там неделю;
 * после этого подключения остаются в «Интеграциях».
 */
export function Onboarding({ step, setStep }: { step: 'mail' | 'claude' | null; setStep(s: 'mail' | 'claude' | null): void }) {
  const { profile, patchProfile } = useSession()
  const { google, tokens, configured, ready, reload } = useConnections()
  const { connect, busy } = useGoogleConnect()
  const box = useRef<HTMLDivElement>(null)
  const [flying, setFlying] = useState(false)
  const [dock, setDock] = useState<HTMLElement | null>(null)
  const auto = useRef(false)

  const mailDone = !!google && google.status !== 'revoked'
  const claudeDone = tokens.length > 0 || !!profile?.onboarding?.claude_done
  const allDone = mailDone && claudeDone
  const closedAt = profile?.onboarding?.closed_at ? +new Date(profile.onboarding.closed_at) : 0
  const docked = !allDone && closedAt > 0 && Date.now() - closedAt < WEEK
  const doneCount = Number(mailDone) + Number(claudeDone)

  useEffect(() => setDock(document.getElementById('qs-dock')), [])

  // первое появление: сразу после входа, пока пользователь не закрыл окно сам
  useEffect(() => {
    if (!ready || auto.current || allDone || closedAt) return
    auto.current = true
    setStep(mailDone ? 'claude' : 'mail')
  }, [ready, allDone, closedAt, mailDone, setStep])

  const close = () => {
    const target = document.getElementById('qs-dock')?.getBoundingClientRect()
    const from = box.current?.getBoundingClientRect()
    const finish = () => {
      setFlying(false)
      setStep(null)
      if (!allDone && !profile?.onboarding?.closed_at) patchProfile({ onboarding: { ...profile?.onboarding, closed_at: new Date().toISOString() } })
    }
    if (allDone || !target || !from || !box.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return finish()
    // окно сжимается и летит к месту, где останется плашка
    const scale = Math.max(0.12, Math.min(target.width || 260, 260) / from.width)
    const dx = target.left + (target.width || 260) / 2 - (from.left + from.width / 2)
    const dy = (target.top || innerHeight - 120) + 28 - (from.top + from.height / 2)
    box.current.style.transition = 'transform 0.55s cubic-bezier(0.5, 0, 0.2, 1), opacity 0.55s ease-in'
    box.current.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
    box.current.style.opacity = '0.2'
    setFlying(true)
    setTimeout(finish, 540)
  }

  const finishClaude = () => {
    patchProfile({ onboarding: { ...profile?.onboarding, claude_done: true } })
    setStep(null)
  }

  if (!profile) return null

  return (
    <>
      {docked && dock && !step && createPortal(
        <button type="button" className="qs" onClick={() => setStep(mailDone ? 'claude' : 'mail')}>
          <span className="qs__ring" style={{ ['--p' as string]: doneCount / 2 }}><Sparkles size={16} /></span>
          <span className="qs__text">
            <b>Szybki start</b>
            <small>{mailDone ? 'Zostało podłączyć Claude' : 'Podłącz pocztę — 1 klik'}</small>
          </span>
          <span className="qs__n">{doneCount}/2</span>
        </button>,
        dock,
      )}

      {step && createPortal(
        <div className={cx('modal ob', flying && 'is-flying')} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="modal__box ob__box" ref={box} role="dialog" aria-modal>
            <IconBtn label="Później" className="modal__close" onClick={close}><X size={18} /></IconBtn>
            <div className="ob__steps">
              <span className={cx('ob__step', step === 'mail' && 'is-on', mailDone && 'is-done')} onClick={() => setStep('mail')}>
                <i>{mailDone ? <Check size={13} /> : 1}</i>Poczta
              </span>
              <span className="ob__line" />
              <span className={cx('ob__step', step === 'claude' && 'is-on', claudeDone && 'is-done')} onClick={() => setStep('claude')}>
                <i>{claudeDone ? <Check size={13} /> : 2}</i>Claude
              </span>
            </div>

            {step === 'mail' ? (
              <div className="ob__pane" key="mail">
                <AppIcon size={56} />
                <h2>{mailDone ? 'Poczta podłączona' : 'Podłącz służbową pocztę'}</h2>
                <p className="ob__lead">
                  AURORA sama znajduje w wiadomościach potwierdzone zmiany — nowe ceny, terminy, warunki — i aktualizuje bazę wiedzy. Nie musisz niczego wpisywać ręcznie.
                </p>
                <ul className="ob__facts">
                  <li><Mail size={18} /><span><b>Tylko odczyt</b>AURORA nie wysyła i nie usuwa wiadomości.</span></li>
                  <li><EyeOff size={18} /><span><b>Wiadomości nie są przechowywane</b>Do bazy trafia tylko fakt o produkcie, bez cytatów i nazwisk.</span></li>
                  <li><Lock size={18} /><span><b>Prywatne zostaje prywatne</b>Prywatna korespondencja, wynagrodzenia, HR i negocjacje są odrzucane.</span></li>
                  <li><Calendar size={18} /><span><b>Przy okazji kalendarz</b>Daty premier i wydarzeń produktów pojawią się same.</span></li>
                </ul>
                {mailDone ? (
                  <Button variant="primary" size="lg" block onClick={() => setStep('claude')}>Dalej: podłącz Claude</Button>
                ) : configured ? (
                  <Button variant="accent" size="lg" block busy={busy} onClick={connect} icon={<GoogleG />}>Podłącz Google — 1 klik</Button>
                ) : (
                  <div className="ob__wait">
                    <b>Google nie jest jeszcze skonfigurowany</b>
                    {profile.is_moderator
                      ? <span>Wklej Client ID i Secret — to 5 minut, raz dla całej platformy. <Link to="/app/integrations" onClick={close}>Otwórz instrukcję →</Link></span>
                      : <span>Moderator platformy dokończy konfigurację — przycisk pojawi się tutaj.</span>}
                  </div>
                )}
                {!mailDone && <button type="button" className="ob__skip" onClick={() => setStep('claude')}>Najpierw podłącz Claude</button>}
              </div>
            ) : (
              <div className="ob__pane" key="claude">
                <AppIcon size={56} tone="black" />
                <h2>Podłącz Claude</h2>
                <p className="ob__lead">
                  Claude będzie odpowiadać na podstawie Twojej bazy wiedzy, a gdy dowie się czegoś nowego o produktach — zapyta, czy zaktualizować to w AURORA.
                </p>
                <ClaudeSetup tokens={tokens} onChange={reload} compact />
                <Button variant={claudeDone ? 'primary' : 'ghost'} size="lg" block onClick={claudeDone ? finishClaude : close}>
                  {claudeDone ? 'Gotowe' : 'Przypomnij później'}
                </Button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
    <path fill="#000" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#000" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" opacity=".75" />
    <path fill="#000" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z" opacity=".5" />
    <path fill="#000" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" opacity=".9" />
  </svg>
)
