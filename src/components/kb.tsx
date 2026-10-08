import { Bot, Calendar, CircleCheck, Clock, FileText, Globe, Mail, MessageSquare, PenLine } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { emitChanged } from '../app/Shell'
import { useSession } from '../app/session'
import { BRAND_ICONS, BrandIcon } from '../brand/Logo'
import { useT } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'
import type { Collection, Entry, EntryType, Product, ProductState, Source } from '../lib/types'
import { Badge, Button, cx, Field, Modal, Segmented, Toggle, useFeedback } from './ui'

export function useTypeLabels(): Record<EntryType, string> {
  const t = useT()
  return {
    fact: t('Факт', 'Fakt'),
    price: t('Цена', 'Cena'),
    date: t('Дата', 'Termin'),
    news: t('Новость', 'Aktualność'),
    announcement: t('Коммуникат', 'Komunikat'),
    faq: 'FAQ',
    link: t('Ссылка', 'Link'),
    document: t('Документ', 'Dokument'),
  }
}

export function StateBadge({ state }: { state: ProductState | Entry['status'] }) {
  const t = useT()
  if (state === 'review' || state === 'outdated') return <Badge tone="accent" icon={<Clock size={14} />}>{t('Проверить', 'Sprawdź')}</Badge>
  if (state === 'archived') return <Badge>{t('В архиве', 'W archiwum')}</Badge>
  return <Badge icon={<CircleCheck size={14} />}>{t('Актуально', 'Aktualne')}</Badge>
}

const SOURCE_ICON: Record<Source, ReactNode> = {
  manual: <PenLine size={13} />,
  email: <Mail size={13} />,
  calendar: <Calendar size={13} />,
  claude: <Bot size={13} />,
  website: <Globe size={13} />,
  file: <FileText size={13} />,
  chat: <MessageSquare size={13} />,
}

export function SourceTag({ source, label }: { source: Source; label?: string | null }) {
  const t = useT()
  const names: Record<Source, string> = {
    manual: t('Вручную', 'Ręcznie'), email: t('Почта', 'Poczta'), calendar: t('Календарь', 'Kalendarz'), claude: 'Claude',
    website: t('Сайт', 'Strona'), file: t('Файл', 'Plik'), chat: t('Чат', 'Czat'),
  }
  return <span className="srctag" title={label ?? undefined}>{SOURCE_ICON[source]}{label || names[source]}</span>
}

export function ProductIcon({ icon, accent, size = 44 }: { icon: string; accent?: boolean; size?: number }) {
  return <span className={cx('picon', accent && 'picon--accent')} style={{ width: size, height: size }}><BrandIcon name={icon} size={size * 0.56} /></span>
}

// ───────── редактор записи ─────────

export function EntryEditor({ open, onClose, entry, productId, preset }: {
  open: boolean
  onClose(saved?: boolean): void
  entry?: Entry | null
  productId?: string | null
  preset?: Partial<Entry>
}) {
  const t = useT()
  const types = useTypeLabels()
  const { company } = useSession()
  const { fail, toast } = useFeedback()
  const blank = { type: 'fact' as EntryType, title: '', body: '', effective_from: '', effective_to: '', importance: 1, pinned: false }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    const src = entry ?? preset
    setF({
      type: src?.type ?? blank.type, title: src?.title ?? '', body: src?.body ?? '',
      effective_from: src?.effective_from ?? '', effective_to: src?.effective_to ?? '',
      importance: src?.importance ?? 1, pinned: src?.pinned ?? false,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id])

  const save = async () => {
    if (!company) return
    setBusy(true)
    const row = {
      type: f.type, title: f.title.trim(), body: f.body.trim(), importance: f.importance, pinned: f.pinned,
      effective_from: f.effective_from || null, effective_to: f.effective_to || null,
    }
    const q = entry
      ? supabase.from('entries').update({ ...row, status: 'current', verified_at: new Date().toISOString() }).eq('id', entry.id).select('id').single()
      : supabase.from('entries').insert({ ...row, company_id: company.id, product_id: productId ?? null, source: 'manual', verified_at: new Date().toISOString() }).select('id').single()
    const { data, error } = await q
    setBusy(false)
    if (error || !data) return fail(error?.message ?? 'error')
    api('embed', { ids: [data.id] }).catch(() => {})
    toast(entry ? t('Сохранено', 'Zapisano') : t('Добавлено в базу знаний', 'Dodano do bazy wiedzy'))
    emitChanged()
    onClose(true)
  }

  const isNews = f.type === 'announcement' || f.type === 'news'
  return (
    <Modal open={open} onClose={() => onClose()} width={600}
      title={entry ? t('Изменить запись', 'Edytuj wpis') : isNews ? t('Новый коммуникат', 'Nowy komunikat') : t('Новая запись', 'Nowy wpis')}
      footer={<><Button onClick={() => onClose()}>{t('Отмена', 'Anuluj')}</Button><Button variant="primary" busy={busy} disabled={!f.title.trim()} onClick={save}>{t('Сохранить', 'Zapisz')}</Button></>}>
      <div className="form">
        <Field label={t('Тип', 'Typ')}>
          <div className="chips">
            {(['fact', 'price', 'date', 'news', 'announcement', 'faq', 'link'] as EntryType[]).map((k) => (
              <button key={k} type="button" className={cx('chip', f.type === k && 'is-on')} onClick={() => setF({ ...f, type: k })}>{types[k]}</button>
            ))}
          </div>
        </Field>
        <Field label={t('Заголовок', 'Tytuł')}>
          <input className="input" autoFocus value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder={f.type === 'price' ? t('Цена тарифа Team', 'Cena pakietu Team') : t('Коротко и конкретно', 'Krótko i konkretnie')} />
        </Field>
        <Field label={t('Содержание', 'Treść')} hint={t('Пишите полными фразами с конкретными значениями — так ИИ ответит точнее.', 'Pisz pełnymi zdaniami z konkretnymi wartościami — AI odpowie dokładniej.')}>
          <textarea className="textarea" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div className="form__row">
          <Field label={t('Действует с', 'Obowiązuje od')}><input type="date" className="input" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} /></Field>
          <Field label={t('Действует до', 'Obowiązuje do')} hint={t('После этой даты запись попросит проверки', 'Po tej dacie wpis poprosi o sprawdzenie')}><input type="date" className="input" value={f.effective_to} onChange={(e) => setF({ ...f, effective_to: e.target.value })} /></Field>
        </div>
        <Field label={t('Важность', 'Ważność')}>
          <Segmented value={String(f.importance)} onChange={(v) => setF({ ...f, importance: Number(v) })} options={[
            { value: '0', label: t('Низкая', 'Niska') }, { value: '1', label: t('Обычная', 'Zwykła') },
            { value: '2', label: t('Важно', 'Ważne') }, { value: '3', label: t('Срочно', 'Pilne') },
          ]} />
        </Field>
        {isNews && <Toggle checked={f.pinned} onChange={(pinned) => setF({ ...f, pinned })} label={t('Закрепить наверху', 'Przypnij na górze')}
          hint={t('Коммуникат с важностью «Важно» и выше получит вся команда.', 'Komunikat o ważności „Ważne” i wyższej dostanie cały zespół.')} />}
      </div>
    </Modal>
  )
}

// ───────── редактор продукта ─────────

export function ProductEditor({ open, onClose, product, collections, defaultCollection }: {
  open: boolean
  onClose(id?: string): void
  product?: Product | null
  collections: Collection[]
  defaultCollection?: string | null
}) {
  const t = useT()
  const { company } = useSession()
  const { fail, toast } = useFeedback()
  const [f, setF] = useState({ name: '', kind: '', icon: 'spark', summary: '', description: '', collection_id: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setF({
      name: product?.name ?? '', kind: product?.kind ?? '', icon: product?.icon ?? BRAND_ICONS[Math.floor(Math.random() * 6)],
      summary: product?.summary ?? '', description: product?.description ?? '', collection_id: product?.collection_id ?? defaultCollection ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id])
  const save = async () => {
    if (!company) return
    setBusy(true)
    const row = { ...f, name: f.name.trim(), collection_id: f.collection_id || null }
    const { data, error } = product
      ? await supabase.from('products').update(row).eq('id', product.id).select('id').single()
      : await supabase.from('products').insert({ ...row, company_id: company.id, last_verified_at: new Date().toISOString() }).select('id').single()
    setBusy(false)
    if (error || !data) return fail(error?.message ?? 'error')
    toast(product ? t('Сохранено', 'Zapisano') : t('Продукт добавлен', 'Produkt dodany'))
    emitChanged()
    onClose(data.id)
  }
  return (
    <Modal open={open} onClose={() => onClose()} width={600} title={product ? t('Изменить продукт', 'Edytuj produkt') : t('Новый продукт', 'Nowy produkt')}
      footer={<><Button onClick={() => onClose()}>{t('Отмена', 'Anuluj')}</Button><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2} onClick={save}>{product ? t('Сохранить', 'Zapisz') : t('Добавить', 'Dodaj')}</Button></>}>
      <div className="form">
        <Field label={t('Знак', 'Znak')}>
          <div className="iconpick">
            {BRAND_ICONS.map((name) => (
              <button key={name} type="button" className={cx(f.icon === name && 'is-on')} onClick={() => setF({ ...f, icon: name })} aria-label={name}><BrandIcon name={name} size={24} /></button>
            ))}
          </div>
        </Field>
        <div className="form__row">
          <Field label={t('Название', 'Nazwa')}><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('Вид', 'Rodzaj')}><input className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder={t('Сервис, курс, событие…', 'Usługa, kurs, wydarzenie…')} /></Field>
        </div>
        <Field label={t('Коллекция', 'Kolekcja')}>
          <select className="select" value={f.collection_id} onChange={(e) => setF({ ...f, collection_id: e.target.value })}>
            <option value="">{t('Без коллекции', 'Bez kolekcji')}</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={t('Коротко', 'Krótko')} hint={t('Одна фраза — она видна на карточке', 'Jedno zdanie — widoczne na karcie')}>
          <input className="input" value={f.summary} maxLength={200} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        </Field>
        <Field label={t('Описание', 'Opis')}>
          <textarea className="textarea" rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

// ───────── импорт: текст → факты ─────────

export function ImportText({ open, onClose, productId }: { open: boolean; onClose(): void; productId?: string | null }) {
  const t = useT()
  const { company } = useSession()
  const { fail } = useFeedback()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ applied: number; proposed: number; titles: string[] } | null>(null)
  useEffect(() => {
    if (open) {
      setText('')
      setResult(null)
    }
  }, [open])
  const run = async () => {
    if (!company) return
    setBusy(true)
    try {
      setResult(await api('import_text', { company_id: company.id, text, product_id: productId ?? null, label: t('Импорт текста', 'Import tekstu') }))
      emitChanged()
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  return (
    <Modal open={open} onClose={onClose} width={640} title={t('Вставьте текст — ИИ разложит его на факты', 'Wklej tekst — AI rozłoży go na fakty')}
      subtitle={!result && t('Оферта, прайс, описание с сайта, заметки со встречи. Личное и непроверенное отбрасывается.', 'Oferta, cennik, opis ze strony, notatki ze spotkania. Prywatne i niepotwierdzone jest odrzucane.')}
      footer={result
        ? <Button variant="primary" onClick={onClose}>{t('Готово', 'Gotowe')}</Button>
        : <><Button onClick={onClose}>{t('Отмена', 'Anuluj')}</Button><Button variant="primary" busy={busy} disabled={text.trim().length < 40} onClick={run}>{busy ? t('Читаю…', 'Czytam…') : t('Разобрать', 'Analizuj')}</Button></>}>
      {result ? (
        <div className="import-result">
          <div className="import-result__nums">
            <div><b>{result.applied}</b><span>{t('добавлено в базу', 'dodano do bazy')}</span></div>
            <div><b>{result.proposed}</b><span>{t('ждут проверки', 'czeka na sprawdzenie')}</span></div>
          </div>
          {result.titles.length > 0 && <ul>{result.titles.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {!result.applied && !result.proposed && <p className="muted">{t('Новых фактов не нашлось: всё уже есть в базе или текст не про продукты.', 'Nie znaleziono nowych faktów: wszystko już jest w bazie albo tekst nie dotyczy produktów.')}</p>}
        </div>
      ) : (
        <textarea className="textarea" rows={12} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Вставьте сюда текст…', 'Wklej tutaj tekst…')} />
      )}
    </Modal>
  )
}
