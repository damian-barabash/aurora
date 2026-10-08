import { Download, FileText, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { emitChanged } from '../app/Shell'
import { useCompany } from '../app/session'
import { canExtract, fmtSize, isImage, removeFile, uploadFile } from '../lib/files'
import { fmtDate } from '../lib/format'
import { leave } from '../lib/motion'
import { api, signedUrls } from '../lib/supabase'
import type { FileRow } from '../lib/types'
import { cx, IconBtn, Spinner, useFeedback } from './ui'

/** Зона загрузки + сетка файлов. Используется на странице продукта, в «Файлах» и в айдентике бренда. */
export function FileGrid({ files, onChange, productId, kind, accept, hint }: {
  files: FileRow[]
  onChange(): void
  productId?: string | null
  kind?: FileRow['kind']
  accept?: string
  hint?: string
}) {
  const company = useCompany()
  const { fail, toast, confirm } = useFeedback()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const [extracting, setExtracting] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    signedUrls(files.map((f) => f.path)).then(setUrls)
  }, [files])

  const upload = async (list: FileList | File[]) => {
    const items = [...list].slice(0, 20)
    setUploading(items.length)
    for (const file of items) {
      try {
        await uploadFile(company.id, file, { productId, kind })
      } catch (e) {
        fail(`${file.name}: ${e instanceof Error ? e.message : e}`)
      }
      setUploading((n) => n - 1)
    }
    setUploading(0)
    onChange()
    emitChanged()
  }

  const extract = async (file: FileRow) => {
    setExtracting(file.id)
    try {
      const res = await api<{ applied: number; proposed: number }>('extract_file', { file_id: file.id })
      toast(`${'Z pliku'}: +${res.applied} ${'do bazy'}, ${res.proposed} ${'do sprawdzenia'}`)
      emitChanged()
    } catch (e) {
      fail(e)
    }
    setExtracting(null)
  }

  const remove = async (file: FileRow) => {
    if (!(await confirm({ title: 'Usunąć plik?', text: file.name, action: 'Usuń', danger: true }))) return
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
        <b>{uploading ? `${'Wgrywam'}… ${uploading}` : 'Przeciągnij pliki lub kliknij'}</b>
        <span>{hint ?? 'Zdjęcia, logotypy, PDF, DOCX — do 25 MB. Z dokumentów AI może wyciągnąć fakty.'}</span>
        <input ref={picker} type="file" hidden multiple accept={accept} onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
      </div>

      {files.length > 0 && (
        <div className="fgrid">
          {files.map((f) => (
            <figure key={f.id} data-id={f.id} className="fcard">
              <a className="fcard__view" href={urls[f.path]} target="_blank" rel="noreferrer">
                {isImage(f) && urls[f.path] ? <img src={urls[f.path]} alt={f.name} loading="lazy" /> : <FileText size={30} />}
              </a>
              <figcaption>
                <b className="truncate" title={f.name}>{f.name}</b>
                <small>{fmtSize(f.size)} · {fmtDate(f.created_at, false)}</small>
              </figcaption>
              <div className="fcard__acts">
                {canExtract(f) && (
                  <IconBtn label="Wyciągnij wiedzę z pliku" onClick={() => extract(f)} disabled={extracting === f.id}>
                    {extracting === f.id ? <Spinner size={15} /> : <Sparkles size={16} />}
                  </IconBtn>
                )}
                <a className="iconbtn" href={urls[f.path]} download={f.name} title="Pobierz"><Download size={16} /></a>
                <IconBtn label="Usuń" onClick={() => remove(f)}><Trash2 size={16} /></IconBtn>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
