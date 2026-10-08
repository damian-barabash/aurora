import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { emitChanged } from '../app/Shell'
import { fmtWhen } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { HistoryRow } from '../lib/types'
import { SourceTag } from './kb'
import { Button, cx, useFeedback } from './ui'

const FIELDS: [string, string][] = [
  ['title', 'Tytuł'], ['name', 'Nazwa'], ['body', 'Treść'], ['summary', 'Krótko'], ['description', 'Opis'], ['kind', 'Rodzaj'],
  ['effective_from', 'Od'], ['effective_to', 'Do'], ['status', 'Status'], ['importance', 'Ważność'], ['type', 'Typ'],
]

/** «Машина времени»: лента изменений с разницей «было → стало» и откатом одной кнопкой. */
export function HistoryList({ rows, people, products, onChange, compact }: {
  rows: HistoryRow[]
  people: Record<string, string>
  products?: Record<string, string>
  onChange?(): void
  compact?: boolean
}) {
  const { confirm, fail, toast } = useFeedback()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const verb = (r: HistoryRow) => {
    const product = r.target === 'product'
    if (r.action === 'create') return product ? 'Utworzono produkt' : 'Dodano'
    if (r.action === 'delete') return 'Usunięto'
    if (r.action === 'revert') return 'Przywrócono poprzednią wersję'
    return 'Zmieniono'
  }

  const revert = async (r: HistoryRow) => {
    const ok = await confirm({
      title: r.action === 'create' ? 'Cofnąć dodanie?' : 'Przywrócić poprzednią wersję?',
      text: r.action === 'create'
        ? 'Wpis trafi do archiwum. Ta akcja też trafi do historii.'
        : 'Bieżąca wartość zostanie zastąpiona tą sprzed zmiany.',
      action: 'Przywróć',
    })
    if (!ok) return
    setBusy(r.id)
    const { error } = await supabase.rpc('history_revert', { p_id: r.id })
    setBusy(null)
    if (error) return fail(error.message)
    toast('Wersja przywrócona')
    emitChanged()
    onChange?.()
  }

  const diff = (r: HistoryRow) =>
    FIELDS.map(([key, label]) => {
      const before = r.before?.[key]
      const after = r.after?.[key]
      if (r.action === 'update' || r.action === 'revert') {
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return null
      } else if ((r.after ?? r.before)?.[key] == null || (r.after ?? r.before)?.[key] === '') return null
      return { key, label, before, after }
    }).filter(Boolean) as { key: string; label: string; before: unknown; after: unknown }[]

  return (
    <ol className={cx('hist', compact && 'hist--compact')}>
      {rows.map((r) => {
        const changes = open === r.id ? diff(r) : []
        return (
          <li key={r.id} className={cx('hist__row', open === r.id && 'is-open')}>
            <i className={cx('hist__dot', r.action === 'create' && 'is-new', r.action === 'revert' && 'is-revert')} />
            <button type="button" className="hist__head" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="hist__title">
                <b>{verb(r)}</b>
                <span className="truncate">{r.title}</span>
              </span>
              <span className="hist__meta">
                {products && r.product_id && products[r.product_id] && <Link to={`/app/kb/${r.product_id}`} onClick={(e) => e.stopPropagation()}>{products[r.product_id]}</Link>}
                <SourceTag source={r.source} />
                {r.actor && people[r.actor] && <span>{people[r.actor]}</span>}
                <time>{fmtWhen(r.created_at)}</time>
              </span>
            </button>
            {open === r.id && (
              <div className="hist__diff">
                {changes.map((c) => (
                  <div key={c.key} className="hist__change">
                    <small>{c.label}</small>
                    {(r.action === 'update' || r.action === 'revert') && <del>{String(c.before ?? '—')}</del>}
                    <ins>{String((r.action === 'delete' ? c.before : c.after) ?? '—')}</ins>
                  </div>
                ))}
                {!compact && r.action !== 'delete' && (
                  <Button size="sm" icon={<RotateCcw size={15} />} busy={busy === r.id} onClick={() => revert(r)}>
                    {r.action === 'create' ? 'Cofnij dodanie' : 'Przywróć poprzednią wersję'}
                  </Button>
                )}
                {!compact && r.action === 'delete' && (
                  <Button size="sm" icon={<RotateCcw size={15} />} busy={busy === r.id} onClick={() => revert(r)}>Przywróć</Button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
