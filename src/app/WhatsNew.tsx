import { ArrowRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ReleaseIcon } from '../brand/ReleaseIcons'
import { Button, cx, IconBtn } from '../components/ui'
import { fmtDate } from '../lib/format'
import RELEASES from '../releases.json'
import { useSession } from './session'

export interface Release {
  version: string
  date: string
  icon: string
  title: string
  lead: string
  items: { title: string; text: string }[]
}

export const APP_VERSION = __APP_VERSION__
const LOCK_SECONDS = 5
const OPEN_EVENT = 'aurora:whats-new'

/** Otwiera okno z pełną historią zmian (z menu użytkownika). */
export const openWhatsNew = () => window.dispatchEvent(new Event(OPEN_EVENT))

const cmp = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Wersje, których użytkownik jeszcze nie widział — od najnowszej. Nowe konto widzi tylko ostatnią. */
function unseenFor(seen: string | null): Release[] {
  const live = (RELEASES as Release[]).filter((r) => cmp(r.version, APP_VERSION) <= 0)
  if (!seen) return live.slice(0, 1)
  return live.filter((r) => cmp(r.version, seen) > 0)
}

/**
 * „Co nowego” po aktualizacji. Pokazuje się raz, przy pierwszym wejściu do panelu po nowej wersji.
 * Pominięte wersje sumują się w jedno okno (strony od najnowszej). Pierwszej strony nie da się zamknąć
 * przez 5 sekund, kolejne można zamknąć od razu.
 */
export function WhatsNew() {
  const { profile, patchProfile } = useSession()
  const unseen = useMemo(() => (profile ? unseenFor(profile.seen_version) : []), [profile])
  const [dismissed, setDismissed] = useState(false)
  const [history, setHistory] = useState(false)
  const [step, setStep] = useState(0)
  const [left, setLeft] = useState(LOCK_SECONDS)

  const list = history ? (RELEASES as Release[]) : unseen
  const open = history || (!dismissed && unseen.length > 0)
  const locked = !history && step === 0 && left > 0

  useEffect(() => {
    const show = () => {
      setStep(0)
      setHistory(true)
    }
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [])

  useEffect(() => {
    if (!open || history) return
    setLeft(LOCK_SECONDS)
    const timer = setInterval(() => setLeft((s) => (s <= 1 ? (clearInterval(timer), 0) : s - 1)), 1000)
    return () => clearInterval(timer)
  }, [open, history])

  useEffect(() => {
    if (!open) return
    document.body.classList.add('locked')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) close() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('locked')
      document.removeEventListener('keydown', onKey)
    }
  })

  function close() {
    if (locked) return
    if (!history) {
      setDismissed(true)
      patchProfile({ seen_version: APP_VERSION })
    }
    setHistory(false)
    setStep(0)
  }

  if (!open || !list.length) return null
  const r = list[Math.min(step, list.length - 1)]
  const last = step >= list.length - 1

  return createPortal(
    <div className="modal whatsnew" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal__box whatsnew__box" role="dialog" aria-modal aria-labelledby="whatsnew-title">
        <IconBtn label={locked ? `Zamknij za ${left} s` : 'Zamknij'} className={cx('modal__close', locked && 'is-locked')} disabled={locked} onClick={close}>
          {locked ? <b className="whatsnew__count">{left}</b> : <X size={18} />}
        </IconBtn>
        <div className="whatsnew__scroll">
        <div className="whatsnew__icon"><ReleaseIcon name={r.icon} size={96} /></div>
        <div className="whatsnew__meta">
          <span>Wersja {r.version}</span>
          <span>{fmtDate(r.date)}</span>
          {list.length > 1 && <span>{history ? 'Historia zmian' : `${list.length} aktualizacje od ostatniej wizyty`}</span>}
        </div>
        <h2 id="whatsnew-title">{r.title}</h2>
        <p className="whatsnew__lead">{r.lead}</p>
        <ul className="whatsnew__list">
          {r.items.map((it) => (
            <li key={it.title}><b>{it.title}</b><span>{it.text}</span></li>
          ))}
        </ul>
        </div>
        <footer className="whatsnew__foot">
          {list.length > 1 && (
            <span className="whatsnew__dots">
              {list.map((x, i) => (
                <button key={x.version} type="button" className={cx(i === step && 'is-on')} disabled={locked} aria-label={`Wersja ${x.version}`} onClick={() => setStep(i)} />
              ))}
            </span>
          )}
          <span className="grow" />
          {!last && <Button disabled={locked} trailing={<ArrowRight size={16} />} onClick={() => setStep(step + 1)}>Wcześniejsza wersja</Button>}
          <Button variant="primary" disabled={locked} onClick={close}>{locked ? `Przeczytaj · ${left}` : 'Rozumiem'}</Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
