import { Archive, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark, useBrands } from '../app/brands'
import { emitChanged } from '../app/Shell'
import { useCompany } from '../app/session'
import { toWebp } from '../lib/files'
import { supabase } from '../lib/supabase'
import type { Brand } from '../lib/types'
import { Button, Field, Modal, useFeedback } from './ui'

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'marka'

/** Nowa marka albo edycja: nazwa, klaster, skróty (po nich AI rozpoznaje markę w tekstach), strona, opis i logo. */
export function BrandEditor({ open, onClose, brand, defaultCluster }: { open: boolean; onClose(id?: string): void; brand?: Brand | null; defaultCluster?: string | null }) {
  const company = useCompany()
  const { all, rows } = useBrands()
  const { fail, toast, confirm } = useFeedback()
  const nav = useNavigate()
  // cluster_id: '' = bez kategorii, 'new' = nowa kategoria o nazwie newCluster
  const [f, setF] = useState({ name: '', cluster_id: '', newCluster: '', aliases: '', website: '', summary: '' })
  const [logo, setLogo] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setLogo(null)
    setF({
      name: brand?.name ?? '', cluster_id: brand ? brand.cluster_id ?? '' : defaultCluster ?? '', newCluster: '', aliases: (brand?.aliases ?? []).join(', '),
      website: brand?.website ?? '', summary: brand?.summary ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brand?.id])
  useEffect(() => {
    if (!logo) return setPreview('')
    const url = URL.createObjectURL(logo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logo])

  const save = async () => {
    setBusy(true)
    const website = f.website.trim() ? (/^https?:\/\//i.test(f.website.trim()) ? f.website.trim() : `https://${f.website.trim()}`) : null
    let clusterId: string | null = f.cluster_id && f.cluster_id !== 'new' ? f.cluster_id : null
    if (f.cluster_id === 'new' && f.newCluster.trim()) {
      const name = f.newCluster.trim()
      const same = rows.find((c) => c.name.toLowerCase() === name.toLowerCase())
      if (same) clusterId = same.id
      else {
        const { data, error } = await supabase.from('brand_clusters')
          .insert({ company_id: company.id, name, position: Math.max(0, ...rows.map((c) => c.position)) + 10 }).select('id').single()
        if (error || !data) { setBusy(false); return fail(error?.message ?? 'error') }
        clusterId = data.id
      }
    }
    const row = {
      name: f.name.trim(), cluster_id: clusterId, website, summary: f.summary.trim(),
      aliases: f.aliases.split(',').map((a) => a.trim()).filter(Boolean),
    }
    let id = brand?.id
    if (brand) {
      const { error } = await supabase.from('brands').update(row).eq('id', brand.id)
      if (error) { setBusy(false); return fail(error.message) }
    } else {
      let slug = slugify(row.name)
      if (all.some((b) => b.slug === slug)) slug = `${slug}-${all.length + 1}`
      const { data, error } = await supabase.from('brands')
        .insert({ ...row, company_id: company.id, slug, position: (Math.max(0, ...all.map((b) => b.position)) + 10) }).select('id').single()
      if (error || !data) { setBusy(false); return fail(error?.message ?? 'error') }
      id = data.id
      await supabase.from('brand').insert({ company_id: company.id, brand_id: id })
    }
    if (logo && id) {
      try {
        const webp = await toWebp(logo, 512, 0.9)
        const path = `${company.id}/brands/${id}/logo-${crypto.randomUUID().slice(0, 8)}.webp`
        const { error } = await supabase.storage.from('media').upload(path, webp, { contentType: 'image/webp' })
        if (error) throw new Error(error.message)
        await supabase.from('brands').update({ logo_path: path }).eq('id', id)
        if (brand?.logo_path) await supabase.storage.from('media').remove([brand.logo_path])
      } catch (e) {
        fail(e)
      }
    }
    setBusy(false)
    toast(brand ? 'Marka zapisana' : 'Marka dodana — AI już ją rozpoznaje')
    emitChanged()
    onClose(id)
  }

  const archive = async () => {
    if (!brand) return
    const back = brand.status === 'archived'
    if (!back && !(await confirm({ title: `Przenieść „${brand.name}” do archiwum?`, text: 'Marka zniknie z menu i podpowiedzi dla AI. Produkty i wpisy zostaną w bazie.', action: 'Do archiwum' }))) return
    await supabase.from('brands').update({ status: back ? 'active' : 'archived' }).eq('id', brand.id)
    emitChanged()
    onClose()
    if (!back) nav('/app/kb')
  }

  const remove = async () => {
    if (!brand) return
    const [{ count: products }, { count: entries }] = await Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id),
      supabase.from('entries').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id),
    ])
    // usunięcie marki przeniosłoby jej wiedzę do całej grupy — na to pozwalamy tylko pustej marce
    if ((products ?? 0) + (entries ?? 0) > 0) {
      return fail(`Marka ma ${products ?? 0} produktów i ${entries ?? 0} wpisów. Przenieś je do innej marki albo zarchiwizuj markę.`)
    }
    if (!(await confirm({ title: `Usunąć markę „${brand.name}”?`, text: 'Razem z jej profilem. Tej akcji nie można cofnąć.', action: 'Usuń', danger: true }))) return
    const { error } = await supabase.from('brands').delete().eq('id', brand.id)
    if (error) return fail(error.message)
    if (brand.logo_path) await supabase.storage.from('media').remove([brand.logo_path])
    emitChanged()
    onClose()
    nav('/app/kb')
  }

  return (
    <Modal open={open} onClose={() => onClose()} width={600} title={brand ? 'Edytuj markę' : 'Nowa marka'}
      subtitle={!brand && 'Marka ma własne produkty, stronę, strategię, ton i identyfikację.'}
      footer={
        <>
          {brand && (
            <span className="modal__left">
              <Button variant="quiet" icon={<Archive size={16} />} onClick={archive}>{brand.status === 'archived' ? 'Przywróć' : 'Archiwizuj'}</Button>
              <Button variant="quiet" icon={<Trash2 size={16} />} onClick={remove}>Usuń</Button>
            </span>
          )}
          <Button onClick={() => onClose()}>Anuluj</Button>
          <Button variant="primary" busy={busy} disabled={f.name.trim().length < 2 || (f.cluster_id === 'new' && !f.newCluster.trim())} onClick={save}>{brand ? 'Zapisz' : 'Dodaj'}</Button>
        </>
      }>
      <div className="form">
        <Field label="Logo">
          <div className="logopick">
            {preview ? <span className="bmark bmark--logo" style={{ width: 64, height: 64 }}><img src={preview} alt="" /></span> : <BrandMark brand={brand ?? { ...emptyBrand, name: f.name || 'M' }} size={64} />}
            <Button size="sm" icon={<ImagePlus size={15} />} onClick={() => picker.current?.click()}>{brand?.logo_path || preview ? 'Zmień logo' : 'Wgraj logo'}</Button>
            <input ref={picker} type="file" hidden accept="image/*" onChange={(e) => { if (e.target.files?.[0]) setLogo(e.target.files[0]); e.target.value = '' }} />
          </div>
        </Field>
        <div className="form__row">
          <Field label="Nazwa"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fastline Racing Academy" /></Field>
          <Field label="Kategoria">
            <select className="select" value={f.cluster_id} onChange={(e) => setF({ ...f, cluster_id: e.target.value })}>
              <option value="">Bez kategorii</option>
              {rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="new">+ Nowa kategoria…</option>
            </select>
          </Field>
        </div>
        {f.cluster_id === 'new' && (
          <Field label="Nazwa nowej kategorii"><input className="input" autoFocus value={f.newCluster} onChange={(e) => setF({ ...f, newCluster: e.target.value })} placeholder="np. Lifestyle & Motorsport" /></Field>
        )}
        <Field label="Skróty i inne nazwy" hint="Po przecinku, np. FRA, Fastline Academy. Po nich AI rozpoznaje markę w mailach i rozmowach z Claude.">
          <input className="input" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />
        </Field>
        <Field label="Strona WWW"><input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></Field>
        <Field label="Krótko" hint="Jedno zdanie: czym zajmuje się marka. AI używa go do rozpoznawania, czego dotyczy tekst.">
          <input className="input" value={f.summary} maxLength={240} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

const emptyBrand: Brand = {
  id: '', company_id: '', name: '', slug: '', cluster: '', cluster_id: null, aliases: [], summary: '', website: null, logo_path: null, position: 0, status: 'active',
}
