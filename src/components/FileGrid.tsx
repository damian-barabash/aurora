import { CircleAlert, CircleCheck, CircleDashed, Download, FileText, ImageOff, RotateCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { emitChanged } from '../app/Shell'
import { useCompany } from '../app/session'
import { canExtract, fmtSize, isImage, removeFile, uploadFile } from '../lib/files'
import { fmtDate, fmtWhen, plural } from '../lib/format'
import { leave } from '../lib/motion'
import { api, signedUrls } from '../lib/supabase'
import type { FileRow } from '../lib/types'
import { IngestReport } from './kb'
import { Button, cx, IconBtn, Modal, Spinner, useFeedback } from './ui'

const facts = (n: number) => `${n} ${plural(n, ['fakt', 'fakty', 'faktów'])}`

/** Etykieta przy pliku: czy AI go przeczytało i co z niego trafiło do bazy. */
export function FileStatus({ file, onOpen }: { file: FileRow; onOpen?(): void }) {
  const r = file.ai_result
  const map: Record<FileRow['ai_status'], { tone: string; icon: ReactNode; text: string }> = {
    queued: { tone: 'wait', icon: <CircleDashed size={13} />, text: r?.progress ? `AI czyta… ${r.progress.done}/${r.progress.total}` : 'Czeka na AI' },
    reading: { tone: 'wait', icon: <Spinner size={12} />, text: r?.progress && r.progress.total > 1 ? `AI czyta… ${r.progress.done}/${r.progress.total}` : 'AI czyta…' },
    done: {
      tone: 'ok', icon: <CircleCheck size={13} />,
      text: r ? [r.applied ? `+${facts(r.applied)}` : '', r.proposed ? `${r.proposed} do sprawdzenia` : '', !r.applied && !r.proposed ? 'nic nowego' : ''].filter(Boolean).join(' · ') : 'Przeczytano',
    },
    empty: { tone: 'muted', icon: <CircleCheck size={13} />, text: 'Przeczytano · brak wiedzy' },
    error: { tone: 'err', icon: <CircleAlert size={13} />, text: 'Nie udało się przeczytać' },
    skipped: { tone: 'muted', icon: <ImageOff size={13} />, text: isImage(file) ? 'Obraz — AI nie czyta' : 'Nie czytany' },
  }
  const s = map[file.ai_status] ?? map.skipped
  const clickable = !!onOpen && ['done', 'empty', 'error'].includes(file.ai_status)
  const Tag = clickable ? 'button' : 'span'
  return (
    <Tag type={clickable ? 'button' : undefined} className={cx('fstatus', `fstatus--${s.tone}`)} onClick={clickable ? onOpen : undefined}
      title={file.ai_status === 'error' ? file.ai_error ?? '' : file.ai_read_at ? `Przeczytano ${fmtWhen(file.ai_read_at).toLowerCase()}` : undefined}>
      {s.icon}<span className="truncate">{file.ai_status === 'done' ? `Przeczytano · ${s.text}` : s.text}</span>
    </Tag>
  )
}

/** Зона загрузки + сетка файлов. Документy AI czyta od razu po wgraniu. */
export function FileGrid({ files, onChange, productId, brandId, kind, accept, hint }: {
  files: FileRow[]
  onChange(): void
  productId?: string | null
  brandId?: string | null
  kind?: FileRow['kind']
  accept?: string
  hint?: string
}) {
  const company = useCompany()
  const { fail, toast, confirm } = useFeedback()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const [report, setReport] = useState<FileRow | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    signedUrls(files.map((f) => f.path)).then(setUrls)
  }, [files])

  // dopóki coś się czyta — odświeżamy status co kilka sekund
  const busy = files.some((f) => f.ai_status === 'queued' || f.ai_status === 'reading')
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(onChange, 4000)
    return () => clearInterval(timer)
  }, [busy, onChange])
  // plik w kolejce (np. długi dokument po przerwie funkcji) — panel sam zleca dalsze czytanie, nie czekając na cron
  const nudged = useRef<Record<string, number>>({})
  useEffect(() => {
    for (const f of files) {
      if (f.ai_status !== 'queued' || Date.now() - (nudged.current[f.id] ?? 0) < 60_000) continue
      nudged.current[f.id] = Date.now()
      api('extract_file', { file_id: f.id }).catch(() => {})
    }
  }, [files])
  // gdy plik skończył się czytać — reszta panelu (baza, „Do sprawdzenia”) też się odświeża
  const prev = useRef<Record<string, string>>({})
  useEffect(() => {
    let finished = false
    for (const f of files) {
      if (prev.current[f.id] === 'reading' && f.ai_status !== 'reading') finished = true
      prev.current[f.id] = f.ai_status
    }
    if (finished) emitChanged()
  }, [files])

  const read = async (file: FileRow, force = false) => {
    try {
      await api('extract_file', { file_id: file.id, force })
    } catch (e) {
      fail(e)
    }
    onChange()
  }

  const upload = async (list: FileList | File[]) => {
    const items = [...list].slice(0, 20)
    setUploading(items.length)
    const toRead: FileRow[] = []
    for (const file of items) {
      try {
        const row = await uploadFile(company.id, file, { productId, brandId, kind })
        if (row.ai_status === 'queued') toRead.push(row)
      } catch (e) {
        fail(`${file.name}: ${e instanceof Error ? e.message : e}`)
      }
      setUploading((n) => n - 1)
    }
    setUploading(0)
    if (toRead.length) toast(`AI czyta ${toRead.length === 1 ? 'dokument' : `${toRead.length} dokumenty`} — nowa wiedza pojawi się w bazie za chwilę`)
    for (const f of toRead) {
      nudged.current[f.id] = Date.now()
      await read(f)
    }
    onChange()
    emitChanged()
  }

  const remove = async (file: FileRow) => {
    if (!(await confirm({ title: 'Usunąć plik?', text: `${file.name}. Wiedza dodana z tego pliku zostaje w bazie.`, action: 'Usuń', danger: true }))) return
    await removeFile(file)
    await leave(file.id)
    onChange()
    emitChanged()
  }

  return (
    <div className="files">
      <div
        className={cx('drop', over && 'is-over')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}
        onClick={() => picker.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && picker.current?.click()}
      >
        {uploading ? <Spinner size={20} /> : <Upload size={20} />}
        <b>{uploading ? `Wgrywam… ${uploading}` : 'Przeciągnij pliki lub kliknij'}</b>
        <span>{hint ?? 'Zdjęcia, logotypy, PDF, DOCX — do 25 MB. Dokumenty AI czyta od razu i dodaje z nich fakty.'}</span>
        <input ref={picker} type="file" hidden multiple accept={accept} onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
      </div>

      {files.length > 0 && (
        <div className="fgrid">
          {files.map((f) => (
            <figure key={f.id} data-id={f.id} className={cx('fcard', f.ai_status === 'reading' && 'is-reading')}>
              <a className="fcard__view" href={urls[f.path]} target="_blank" rel="noreferrer">
                {isImage(f) && urls[f.path] ? <img src={urls[f.path]} alt={f.name} loading="lazy" /> : <FileText size={30} />}
              </a>
              <figcaption>
                <b className="truncate" title={f.name}>{f.name}</b>
                <small>{fmtSize(f.size)} · {fmtDate(f.created_at, false)}</small>
                <FileStatus file={f} onOpen={() => setReport(f)} />
              </figcaption>
              <div className="fcard__acts">
                {canExtract(f) && (
                  <IconBtn label={f.ai_status === 'queued' || f.ai_status === 'error' ? 'Przeczytaj teraz' : 'Przeczytaj ponownie'}
                    onClick={() => read(f, true)} disabled={f.ai_status === 'reading'}>
                    {f.ai_status === 'reading' ? <Spinner size={15} /> : <RotateCw size={16} />}
                  </IconBtn>
                )}
                <a className="iconbtn" href={urls[f.path]} download={f.name} title="Pobierz"><Download size={16} /></a>
                <IconBtn label="Usuń" onClick={() => remove(f)}><Trash2 size={16} /></IconBtn>
              </div>
            </figure>
          ))}
        </div>
      )}

      <Modal open={!!report} onClose={() => setReport(null)} width={620} title={report?.name}
        subtitle={report?.ai_status === 'error'
          ? `AI nie przeczytało pliku: ${report.ai_error ?? 'nieznany błąd'}`
          : report?.ai_read_at && `Przeczytano ${fmtWhen(report.ai_read_at).toLowerCase()}${report.ai_result?.chars ? ` · ${report.ai_result.chars.toLocaleString('pl-PL')} znaków tekstu` : ''}`}
        footer={<>
          {report && canExtract(report) && <Button icon={<RotateCw size={16} />} onClick={() => { const f = report; setReport(null); read(f, true) }}>Przeczytaj ponownie</Button>}
          <Button variant="primary" onClick={() => setReport(null)}>Gotowe</Button>
        </>}>
        {report?.ai_result?.items?.length
          ? <IngestReport items={report.ai_result.items} />
          : report?.ai_status !== 'error' && <p className="muted">W tym pliku AI nie znalazło nowej wiedzy firmowej.</p>}
      </Modal>
    </div>
  )
}
