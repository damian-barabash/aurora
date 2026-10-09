import { supabase } from './supabase'
import type { FileRow } from './types'

const safe = (name: string) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80)

export const isImage = (f: { mime: string | null; name: string }) =>
  (f.mime ?? '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif|bmp|heic)$/i.test(f.name)

export const canExtract = (f: { name: string; mime: string | null }) =>
  /\.(pdf|docx|txt|md|csv|html?)$/i.test(f.name) || (f.mime ?? '').startsWith('text/')

export function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Każdy obraz przed wysłaniem staje się WebP (także PNG, JPG, GIF i SVG): mniejsze pliki, jeden format w całej bazie.
 * Safari nie koduje WebP przez canvas (po cichu oddaje PNG) — wtedy doładowujemy koder WASM.
 */
export async function toWebp(file: File, maxSide = 2400, quality = 0.86): Promise<File> {
  if (!isImage({ mime: file.type, name: file.name })) return file
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const vector = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
    const srcW = img.naturalWidth || 1024
    const srcH = img.naturalHeight || 1024
    // grafika wektorowa nie ma własnej rozdzielczości — rysujemy ją tak, by dłuższy bok miał 1600 px
    const scale = vector ? 1600 / Math.max(srcW, srcH) : Math.min(1, maxSide / Math.max(srcW, srcH))
    if (file.type === 'image/webp' && scale === 1) return file
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob || blob.type !== 'image/webp') {
      const { encode } = await import('@jsquash/webp')
      blob = new Blob([await encode(ctx.getImageData(0, 0, w, h), { quality: Math.round(quality * 100) })], { type: 'image/webp' })
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' })
  } catch {
    throw new Error('Nie udało się odczytać obrazu — spróbuj JPG lub PNG')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Plik trafia do prywatnego bucketu: {firma}/{produkt|common}/{losowy id}-{nazwa}. Obrazy zawsze jako WebP. */
export async function uploadFile(companyId: string, original: File, opts: { productId?: string | null; entryId?: string | null; kind?: FileRow['kind'] } = {}): Promise<FileRow> {
  const file = await toWebp(original)
  const path = `${companyId}/${opts.productId ?? 'common'}/${crypto.randomUUID().slice(0, 8)}-${safe(file.name)}`
  const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  const kind = opts.kind ?? (isImage({ mime: file.type, name: file.name }) ? 'image' : 'document')
  const { data, error: rowError } = await supabase.from('files').insert({
    company_id: companyId, product_id: opts.productId ?? null, entry_id: opts.entryId ?? null, kind, name: file.name, path, mime: file.type || null, size: file.size,
  }).select('*').single()
  if (rowError || !data) throw new Error(rowError?.message ?? 'insert failed')
  return data as FileRow
}

export async function removeFile(file: FileRow) {
  await supabase.storage.from('media').remove([file.path])
  await supabase.from('files').delete().eq('id', file.id)
}

/** Logo produktu: kwadratowe pole do 512 px, WebP. Stary plik jest usuwany. */
export async function setProductLogo(companyId: string, productId: string, file: File | null, oldPath?: string | null): Promise<string | null> {
  let path: string | null = null
  if (file) {
    const webp = await toWebp(file, 512, 0.9)
    path = `${companyId}/${productId}/logo-${crypto.randomUUID().slice(0, 8)}.webp`
    const { error } = await supabase.storage.from('media').upload(path, webp, { contentType: 'image/webp' })
    if (error) throw new Error(error.message)
  }
  const { error } = await supabase.from('products').update({ logo_path: path }).eq('id', productId)
  if (error) throw new Error(error.message)
  if (oldPath) await supabase.storage.from('media').remove([oldPath])
  return path
}
