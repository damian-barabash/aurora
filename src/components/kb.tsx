import { Bot, Calendar, CircleCheck, Clock, FileText, Globe, ImagePlus, Mail, MessageSquare, PenLine, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { emitChanged } from '../app/Shell'
import { useSession } from '../app/session'
import { BRAND_ICONS, BrandIcon } from '../brand/Logo'
import { isImage, removeFile, setProductLogo, uploadFile } from '../lib/files'
import { api, supabase } from '../lib/supabase'
import { useSigned } from '../lib/useSigned'
import type { Collection, Entry, EntryType, FileRow, Product, ProductState, Source } from '../lib/types'
import { Badge, Button, cx, Field, Modal, Segmented, Toggle, useFeedback } from './ui'

export function useTypeLabels(): Record<EntryType, string> {
  return {
    fact: 'Fakt',
    price: 'Cena',
    date: 'Termin',
    news: 'Aktualność',
    announcement: 'Komunikat',
    faq: 'FAQ',
    link: 'Link',
    document: 'Dokument',
  }
}

export function StateBadge({ state }: { state: ProductState | Entry['status'] }) {
  if (state === 'review' || state === 'outdated') return <Badge tone="accent" icon={<Clock size={14} />}>Sprawdź</Badge>
  if (state === 'archived') return <Badge>W archiwum</Badge>
  return <Badge icon={<CircleCheck size={14} />}>Aktualne</Badge>
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
  const names: Record<Source, string> = {
    manual: 'Ręcznie', email: 'Poczta', calendar: 'Kalendarz', claude: 'Claude',
    website: 'Strona', file: 'Plik', chat: 'Czat',
  }
  return <span className="srctag" title={label ?? undefined}>{SOURCE_ICON[source]}{label || names[source]}</span>
}

/** Znak produktu: własne logo, a gdy go nie ma — jeden z symboli marki. */
export function ProductIcon({ icon, logo, accent, size = 44 }: { icon: string; logo?: string; accent?: boolean; size?: number }) {
  if (logo) return <span className="picon picon--logo" style={{ width: size, height: size }}><img src={logo} alt="" /></span>
  return <span className={cx('picon', accent && 'picon--accent')} style={{ width: size, height: size }}><BrandIcon name={icon} size={size * 0.56} /></span>
}

/** Zdjęcia przy wpisie: miniatury już zapisanych, podgląd dodawanych i przycisk „dodaj”. */
function PhotoField({ saved, pending, onAdd, onRemoveSaved, onRemovePending }: {
  saved: FileRow[]
  pending: File[]
  onAdd(files: File[]): void
  onRemoveSaved(file: FileRow): void
  onRemovePending(index: number): void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const urls = useSigned(saved.map((f) => f.path))
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const list = pending.map((f) => URL.createObjectURL(f))
    setPreviews(list)
    return () => list.forEach((u) => URL.revokeObjectURL(u))
  }, [pending])
  return (
    <div className="photos">
      {saved.map((f) => (
        <figure key={f.id} className="photos__item">
          {urls[f.path] && <img src={urls[f.path]} alt={f.name} />}
          <button type="button" aria-label="Usuń zdjęcie" onClick={() => onRemoveSaved(f)}><X size={14} /></button>
        </figure>
      ))}
      {previews.map((src, i) => (
        <figure key={src} className="photos__item">
          <img src={src} alt="" />
          <button type="button" aria-label="Usuń zdjęcie" onClick={() => onRemovePending(i)}><X size={14} /></button>
        </figure>
      ))}
      <button type="button" className="photos__add" onClick={() => picker.current?.click()}><ImagePlus size={20} />Dodaj</button>
      <input ref={picker} type="file" hidden multiple accept="image/*" onChange={(e) => { if (e.target.files?.length) onAdd([...e.target.files]); e.target.value = '' }} />
    </div>
  )
}

// ───────── редактор записи ─────────

export function EntryEditor({ open, onClose, entry, productId, preset }: {
  open: boolean
  onClose(saved?: boolean): void
  entry?: Entry | null
  productId?: string | null
  preset?: Partial<Entry>
}) {
  const types = useTypeLabels()
  const { company } = useSession()
  const { fail, toast } = useFeedback()
  const blank = { type: 'fact' as EntryType, title: '', body: '', effective_from: '', effective_to: '', importance: 1, pinned: false }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState<FileRow[]>([])
  const [pending, setPending] = useState<File[]>([])
  useEffect(() => {
    if (!open) return
    setPending([])
    setPhotos([])
    if (entry) supabase.from('files').select('*').eq('entry_id', entry.id).order('created_at').then(({ data }) => setPhotos((data ?? []) as FileRow[]))
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
    if (error || !data) {
      setBusy(false)
      return fail(error?.message ?? 'error')
    }
    for (const file of pending) {
      await uploadFile(company.id, file, { productId: entry?.product_id ?? productId ?? null, entryId: data.id, kind: 'image' }).catch(fail)
    }
    setBusy(false)
    api('embed', { ids: [data.id] }).catch(() => {})
    toast(entry ? 'Zapisano' : 'Dodano do bazy wiedzy')
    emitChanged()
    onClose(true)
  }

  const isNews = f.type === 'announcement' || f.type === 'news'
  return (
    <Modal open={open} onClose={() => onClose()} width={600}
      title={entry ? 'Edytuj wpis' : isNews ? 'Nowy komunikat' : 'Nowy wpis'}
      footer={<><Button onClick={() => onClose()}>Anuluj</Button><Button variant="primary" busy={busy} disabled={!f.title.trim()} onClick={save}>Zapisz</Button></>}>
      <div className="form">
        <Field label="Typ">
          <div className="chips">
            {(['fact', 'price', 'date', 'news', 'announcement', 'faq', 'link'] as EntryType[]).map((k) => (
              <button key={k} type="button" className={cx('chip', f.type === k && 'is-on')} onClick={() => setF({ ...f, type: k })}>{types[k]}</button>
            ))}
          </div>
        </Field>
        <Field label="Tytuł">
          <input className="input" autoFocus value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder={f.type === 'price' ? 'Cena pakietu Team' : 'Krótko i konkretnie'} />
        </Field>
        <Field label="Treść" hint="Pisz pełnymi zdaniami z konkretnymi wartościami — AI odpowie dokładniej.">
          <textarea className="textarea" rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div className="form__row">
          <Field label="Obowiązuje od"><input type="date" className="input" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} /></Field>
          <Field label="Obowiązuje do" hint="Po tej dacie wpis poprosi o sprawdzenie"><input type="date" className="input" value={f.effective_to} onChange={(e) => setF({ ...f, effective_to: e.target.value })} /></Field>
        </div>
        <Field label="Ważność">
          <Segmented value={String(f.importance)} onChange={(v) => setF({ ...f, importance: Number(v) })} options={[
            { value: '0', label: 'Niska' }, { value: '1', label: 'Zwykła' },
            { value: '2', label: 'Ważne' }, { value: '3', label: 'Pilne' },
          ]} />
        </Field>
        <Field label="Zdjęcia" hint="AI pokaże je w czacie, gdy powoła się na ten wpis. Każdy obraz zapisujemy jako WebP.">
          <PhotoField saved={photos} pending={pending} onAdd={(files) => setPending([...pending, ...files.filter((x) => isImage({ mime: x.type, name: x.name }))])}
            onRemovePending={(i) => setPending(pending.filter((_, j) => j !== i))}
            onRemoveSaved={async (file) => { await removeFile(file); setPhotos(photos.filter((x) => x.id !== file.id)); emitChanged() }} />
        </Field>
        {isNews && <Toggle checked={f.pinned} onChange={(pinned) => setF({ ...f, pinned })} label="Przypnij na górze"
          hint="Komunikat o ważności „Ważne” i wyższej dostanie cały zespół." />}
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
  const { company } = useSession()
  const { fail, toast } = useFeedback()
  const [f, setF] = useState({ name: '', kind: '', icon: 'spark', summary: '', description: '', collection_id: '' })
  const [busy, setBusy] = useState(false)
  // logo: undefined = bez zmian, File = nowe, null = usunąć
  const [logo, setLogo] = useState<File | null | undefined>(undefined)
  const [preview, setPreview] = useState('')
  const logoPicker = useRef<HTMLInputElement>(null)
  const current = useSigned([product?.logo_path])[product?.logo_path ?? '']
  useEffect(() => {
    if (!logo) return setPreview('')
    const url = URL.createObjectURL(logo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logo])
  useEffect(() => {
    if (!open) return
    setLogo(undefined)
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
    if (error || !data) {
      setBusy(false)
      return fail(error?.message ?? 'error')
    }
    if (logo !== undefined) await setProductLogo(company.id, data.id, logo, product?.logo_path).catch(fail)
    setBusy(false)
    toast(product ? 'Zapisano' : 'Produkt dodany')
    emitChanged()
    onClose(data.id)
  }
  return (
    <Modal open={open} onClose={() => onClose()} width={600} title={product ? 'Edytuj produkt' : 'Nowy produkt'}
      footer={<><Button onClick={() => onClose()}>Anuluj</Button><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2} onClick={save}>{product ? 'Zapisz' : 'Dodaj'}</Button></>}>
      <div className="form">
        <Field label="Logo produktu" hint="PNG, JPG lub SVG — zapiszemy jako WebP. Bez logo produkt dostaje jeden ze znaków poniżej.">
          <div className="logopick">
            <ProductIcon icon={f.icon} logo={logo === null ? undefined : preview || current} size={64} />
            <Button size="sm" icon={<ImagePlus size={15} />} onClick={() => logoPicker.current?.click()}>{preview || (current && logo !== null) ? 'Zmień logo' : 'Wgraj logo'}</Button>
            {(preview || (current && logo !== null)) && <Button size="sm" variant="quiet" onClick={() => setLogo(null)}>Usuń</Button>}
            <input ref={logoPicker} type="file" hidden accept="image/*" onChange={(e) => { if (e.target.files?.[0]) setLogo(e.target.files[0]); e.target.value = '' }} />
          </div>
        </Field>
        <Field label="Znak">
          <div className="iconpick">
            {BRAND_ICONS.map((name) => (
              <button key={name} type="button" className={cx(f.icon === name && 'is-on')} onClick={() => setF({ ...f, icon: name })} aria-label={name}><BrandIcon name={name} size={24} /></button>
            ))}
          </div>
        </Field>
        <div className="form__row">
          <Field label="Nazwa"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Rodzaj"><input className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="Usługa, kurs, wydarzenie…" /></Field>
        </div>
        <Field label="Kolekcja">
          <select className="select" value={f.collection_id} onChange={(e) => setF({ ...f, collection_id: e.target.value })}>
            <option value="">Bez kolekcji</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Krótko" hint="Jedno zdanie — widoczne na karcie">
          <input className="input" value={f.summary} maxLength={200} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        </Field>
        <Field label="Opis">
          <textarea className="textarea" rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

// ───────── импорт: текст → факты ─────────

export function ImportText({ open, onClose, productId }: { open: boolean; onClose(): void; productId?: string | null }) {
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
      setResult(await api('import_text', { company_id: company.id, text, product_id: productId ?? null, label: 'Import tekstu' }))
      emitChanged()
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }
  return (
    <Modal open={open} onClose={onClose} width={640} title="Wklej tekst — AI rozłoży go na fakty"
      subtitle={!result && 'Oferta, cennik, opis ze strony, notatki ze spotkania. Prywatne i niepotwierdzone jest odrzucane.'}
      footer={result
        ? <Button variant="primary" onClick={onClose}>Gotowe</Button>
        : <><Button onClick={onClose}>Anuluj</Button><Button variant="primary" busy={busy} disabled={text.trim().length < 40} onClick={run}>{busy ? 'Czytam…' : 'Analizuj'}</Button></>}>
      {result ? (
        <div className="import-result">
          <div className="import-result__nums">
            <div><b>{result.applied}</b><span>dodano do bazy</span></div>
            <div><b>{result.proposed}</b><span>czeka na sprawdzenie</span></div>
          </div>
          {result.titles.length > 0 && <ul>{result.titles.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {!result.applied && !result.proposed && <p className="muted">Nie znaleziono nowych faktów: wszystko już jest w bazie albo tekst nie dotyczy produktów.</p>}
        </div>
      ) : (
        <textarea className="textarea" rows={12} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Wklej tutaj tekst…" />
      )}
    </Modal>
  )
}

// ───────── kolekcja: nowa albo zmiana nazwy ─────────

export function CollectionEditor({ open, onClose, collection }: { open: boolean; onClose(id?: string): void; collection?: Collection | null }) {
  const { company } = useSession()
  const { fail, toast } = useFeedback()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setName(collection?.name ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collection?.id])
  const save = async () => {
    if (!company || !name.trim()) return
    setBusy(true)
    const { data, error } = collection
      ? await supabase.from('collections').update({ name: name.trim() }).eq('id', collection.id).select('id').single()
      : await supabase.from('collections').insert({ company_id: company.id, name: name.trim(), position: Math.floor(Date.now() / 1000) }).select('id').single()
    setBusy(false)
    if (error || !data) return fail(error?.message ?? 'error')
    toast(collection ? 'Zapisano' : 'Kolekcja utworzona — przypisz do niej produkty')
    emitChanged()
    onClose(data.id)
  }
  return (
    <Modal open={open} onClose={() => onClose()} width={420} title={collection ? 'Zmień nazwę kolekcji' : 'Nowa kolekcja'}
      subtitle={!collection && 'Kolekcje grupują produkty w menu po lewej, np. „Szkolenia”, „Wydarzenia”, „Usługi”.'}
      footer={<><Button onClick={() => onClose()}>Anuluj</Button><Button variant="primary" busy={busy} disabled={!name.trim()} onClick={save}>{collection ? 'Zapisz' : 'Utwórz'}</Button></>}>
      <Field label="Nazwa"><input className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
    </Modal>
  )
}
