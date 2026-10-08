import { X } from 'lucide-react'
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../lib/supabase'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// ───────── Кнопки ─────────

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'accent' | 'ghost' | 'quiet' | 'danger'
  size?: 'md' | 'sm' | 'lg'
  icon?: ReactNode
  trailing?: ReactNode
  busy?: boolean
  block?: boolean
}

export function Button({ variant = 'ghost', size = 'md', icon, trailing, busy, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', busy && 'is-busy', className)}
    >
      {busy ? <Spinner /> : icon}
      {children && <span>{children}</span>}
      {trailing}
    </button>
  )
}

export function IconBtn({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" {...rest} aria-label={label} title={label} className={cx('iconbtn', className)}>
      {children}
    </button>
  )
}

export const Spinner = ({ size = 16 }: { size?: number }) => <span className="spinner" style={{ width: size, height: size }} aria-hidden />

// ───────── Модальное окно ─────────

export function Modal(props: {
  open: boolean
  onClose(): void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}) {
  // podczas zamykania pokazujemy ostatnią treść — okno gaśnie, zamiast znikać
  const last = useRef(props)
  if (props.open) last.current = props
  const { open, onClose } = props
  const { title, subtitle, children, footer, width = 520, className } = open ? props : last.current
  const [closing, setClosing] = useState(false)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) {
      setClosing(true)
      const timer = setTimeout(() => setClosing(false), 180)
      wasOpen.current = open
      return () => clearTimeout(timer)
    }
    wasOpen.current = open
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.classList.add('locked')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('locked')
    }
  }, [open, onClose])
  if (!open && !closing) return null
  return createPortal(
    <div className={cx('modal', !open && 'is-closing')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal__box', className)} style={{ maxWidth: width }} role="dialog" aria-modal>
        <IconBtn label="Zamknij" className="modal__close" onClick={onClose}><X size={18} /></IconBtn>
        {(title || subtitle) && (
          <header className="modal__head">
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </header>
        )}
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

// ───────── Тосты и подтверждения ─────────

interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}
interface ConfirmOpts {
  title: string
  text?: string
  action?: string
  danger?: boolean
}
interface Feedback {
  toast(text: string, tone?: 'ok' | 'error'): void
  /** показывает понятный текст ошибки API */
  fail(e: unknown): void
  confirm(opts: ConfirmOpts): Promise<boolean>
}

const FeedbackCtx = createContext<Feedback>(null!)
export const useFeedback = () => useContext(FeedbackCtx)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [ask, setAsk] = useState<(ConfirmOpts & { resolve(v: boolean): void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = ++seq.current
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])
  const fail = useCallback((e: unknown) => {
    toast(e instanceof ApiError ? e.text() : e instanceof Error ? e.message : String(e), 'error')
  }, [toast])
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setAsk({ ...opts, resolve })), [])
  const answer = (v: boolean) => {
    ask?.resolve(v)
    setAsk(null)
  }

  return (
    <FeedbackCtx.Provider value={{ toast, fail, confirm }}>
      {children}
      <Modal
        open={!!ask}
        onClose={() => answer(false)}
        title={ask?.title}
        subtitle={ask?.text}
        width={420}
        footer={
          <>
            <Button onClick={() => answer(false)}>Anuluj</Button>
            <Button variant={ask?.danger ? 'danger' : 'primary'} onClick={() => answer(true)} autoFocus>
              {ask?.action ?? 'Potwierdź'}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
      {createPortal(
        <div className="toasts" role="status">
          {toasts.map((x) => <div key={x.id} className={cx('toast', x.tone === 'error' && 'toast--error')}>{x.text}</div>)}
        </div>,
        document.body,
      )}
    </FeedbackCtx.Provider>
  )
}

// ───────── Поля ─────────

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      {label && <span className="field__label">{label}</span>}
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange(v: NoInfer<T>): void; options: { value: NoInfer<T>; label: ReactNode }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={cx(o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange(v: NoInfer<T>): void; tabs: { value: NoInfer<T>; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={tab.value === value} className={cx('tabs__tab', tab.value === value && 'is-on')} onClick={() => onChange(tab.value)}>
          {tab.label}
          {tab.count !== undefined && <span className="tabs__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ───────── Мелочи ─────────

export function Badge({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'accent' | 'dark' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  return <span className={cx('badge', `badge--${tone}`)}>{icon}{children}</span>
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials || '·'}</span>
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export const Loading = () => <div className="loading"><Spinner size={22} /></div>

/** Выпадающее меню: закрывается кликом снаружи и по Escape. */
export function Menu({ trigger, children, align = 'right', up }: { trigger(open: boolean, toggle: () => void): ReactNode; children(close: () => void): ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && <div className={cx('menu__pop', `menu__pop--${align}`, up && 'menu__pop--up')} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, active }: { icon?: ReactNode; children: ReactNode; onClick?(): void; danger?: boolean; active?: boolean }) {
  return (
    <button type="button" role="menuitem" className={cx('menu__item', danger && 'is-danger', active && 'is-active')} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  )
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
