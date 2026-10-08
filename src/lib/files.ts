import { supabase } from './supabase'
import type { FileRow } from './types'

const safe = (name: string) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80)

export const isImage = (f: { mime: string | null; name: string }) =>
  (f.mime ?? '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f.name)

export const canExtract = (f: { name: string; mime: string | null }) =>
  /\.(pdf|docx|txt|md|csv|html?)$/i.test(f.name) || (f.mime ?? '').startsWith('text/')

export function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Файл уходит в приватный бакет: {фирма}/{продукт|common}/{случайный id}-{имя}. */
export async function uploadFile(companyId: string, file: File, opts: { productId?: string | null; kind?: FileRow['kind'] } = {}): Promise<FileRow> {
  const path = `${companyId}/${opts.productId ?? 'common'}/${crypto.randomUUID().slice(0, 8)}-${safe(file.name)}`
  const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  const kind = opts.kind ?? (isImage({ mime: file.type, name: file.name }) ? 'image' : 'document')
  const { data, error: rowError } = await supabase.from('files').insert({
    company_id: companyId, product_id: opts.productId ?? null, kind, name: file.name, path, mime: file.type || null, size: file.size,
  }).select('*').single()
  if (rowError || !data) throw new Error(rowError?.message ?? 'insert failed')
  return data as FileRow
}

export async function removeFile(file: FileRow) {
  await supabase.storage.from('media').remove([file.path])
  await supabase.from('files').delete().eq('id', file.id)
}
