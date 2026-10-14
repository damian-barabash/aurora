import { ArchiveRestore, ArrowDown, ArrowUp, ArrowUpRight, Check, FolderPlus, Globe, MoreHorizontal, PenLine, Plus, Shapes, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark, type Cluster, useBrands } from '../app/brands'
import { emitChanged, Page, usePanel } from '../app/Shell'
import { useCompany, useSession } from '../app/session'
import { BrandEditor } from '../components/BrandEditor'
import { Button, Empty, IconBtn, Menu, MenuItem, useFeedback } from '../components/ui'
import { flash, leave } from '../lib/motion'
import { supabase } from '../lib/supabase'
import { background } from '../lib/sync'
import type { Brand } from '../lib/types'

/**
 * Struktura firmy: kategorie marek i marki w nich. Uniwersalne dla każdej firmy —
 * holding z klastrami, firma z kilkoma markami albo firma bez kategorii.
 */
export default function BrandsPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { reloadBrands, patchBrands, patchClusters } = usePanel()
  const { allClusters, rows, all, group } = useBrands()
  const { fail, toast, confirm } = useFeedback()
  const [editor, setEditor] = useState<{ brand?: Brand; cluster?: string | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [rename, setRename] = useState('')

  if (!canManage) return <Page crumb="Marki i kategorie"><Empty title="Strukturę marek zmieniają administratorzy" /></Page>

  const visible = allClusters.filter((c) => c.id || c.brands.length)
  const archived = all.filter((b) => b.status === 'archived')
  const done = async (id?: string, text?: string) => {
    await reloadBrands()
    emitChanged()
    if (id) flash(id)
    if (text) toast(text)
  }

  const createCluster = async () => {
    const name = newName.trim()
    if (!name) return
    if (rows.some((c) => c.name.toLowerCase() === name.toLowerCase())) return fail('Taka kategoria już istnieje')
    const { data, error } = await supabase.from('brand_clusters')
      .insert({ company_id: company.id, name, position: Math.max(0, ...rows.map((c) => c.position)) + 10 }).select('id').single()
    if (error || !data) return fail(error?.message ?? 'error')
    setNewName('')
    setAdding(false)
    done(data.id, 'Kategoria dodana — przypisz do niej marki')
  }
  const saveRename = async (c: Cluster) => {
    const name = rename.trim()
    setRenaming(null)
    if (!c.id || !name || name === c.name) return
    if (rows.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) return fail('Taka kategoria już istnieje')
    const id = c.id
    patchClusters((list) => list.map((x) => (x.id === id ? { ...x, name } : x)))
    patchBrands((list) => list.map((b) => (b.cluster_id === id ? { ...b, cluster: name } : b)))
    flash(id)
    background('Zmiana nazwy kategorii', async () => {
      const res = await supabase.from('brand_clusters').update({ name }).eq('id', id)
      if (res.error) throw new Error(res.error.message)
      emitChanged()
    }, reloadBrands)
  }
  const moveCluster = async (c: Cluster, dir: -1 | 1) => {
    const list = [...rows]
    const i = list.findIndex((x) => x.id === c.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    patchClusters(() => list.map((x, k) => ({ ...x, position: (k + 1) * 10 })))
    flash(c.id!)
    background('Zmiana kolejności kategorii', async () => {
      const res = await Promise.all(list.map((x, k) => supabase.from('brand_clusters').update({ position: (k + 1) * 10 }).eq('id', x.id)))
      const err = res.find((r) => r.error)?.error
      if (err) throw new Error(err.message)
      emitChanged()
    }, reloadBrands)
  }
  const removeCluster = async (c: Cluster) => {
    if (!c.id) return
    if (!(await confirm({
      title: `Usunąć kategorię „${c.name}”?`,
      text: c.brands.length ? `${c.brands.length} marek zostanie w bazie, tylko bez kategorii.` : 'Kategoria jest pusta.',
      action: 'Usuń', danger: true,
    }))) return
    await leave(c.id)
    const { error } = await supabase.from('brand_clusters').delete().eq('id', c.id)
    if (error) return fail(error.message)
    done(undefined, 'Kategoria usunięta')
  }
  const moveBrand = (b: Brand, clusterId: string | null) => {
    const name = rows.find((x) => x.id === clusterId)?.name ?? ''
    patchBrands((list) => list.map((x) => (x.id === b.id ? { ...x, cluster_id: clusterId, cluster: name } : x)))
    requestAnimationFrame(() => flash(b.id))
    background(`Przenoszenie marki ${b.name}`, async () => {
      const res = await supabase.from('brands').update({ cluster_id: clusterId }).eq('id', b.id)
      if (res.error) throw new Error(res.error.message)
      emitChanged()
    }, reloadBrands)
  }
  const reorderBrand = async (c: Cluster, b: Brand, dir: -1 | 1) => {
    const list = [...c.brands]
    const i = list.findIndex((x) => x.id === b.id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    const base = Math.min(...c.brands.map((x) => x.position))
    const pos = new Map(list.map((x, k) => [x.id, base + k * 10]))
    patchBrands((all) => all.map((x) => (pos.has(x.id) ? { ...x, position: pos.get(x.id)! } : x)).sort((a, z) => a.position - z.position))
    flash(b.id)
    background('Zmiana kolejności marek', async () => {
      const res = await Promise.all(list.map((x) => supabase.from('brands').update({ position: pos.get(x.id) }).eq('id', x.id)))
      const err = res.find((r) => r.error)?.error
      if (err) throw new Error(err.message)
      emitChanged()
    }, reloadBrands)
  }
  const restore = async (b: Brand) => {
    await supabase.from('brands').update({ status: 'active' }).eq('id', b.id)
    done(b.id, `${b.name} przywrócona`)
  }

  return (
    <Page className="page--narrow" crumb="Marki i kategorie">
      <div className="page__head">
        <div>
          <h1>Marki i kategorie</h1>
          <p>Struktura {group}: kategorie, marki w nich i ich kolejność. Tak samo układa je menu, katalog, AI i Claude.</p>
        </div>
        <div className="page__actions">
          <Button icon={<FolderPlus size={18} />} onClick={() => setAdding(true)}>Nowa kategoria</Button>
          <Button variant="accent" icon={<Plus size={18} />} onClick={() => setEditor({})}>Nowa marka</Button>
        </div>
      </div>

      {adding && (
        <div className="bclu bclu--new">
          <input className="input" autoFocus value={newName} placeholder="Nazwa kategorii, np. Lifestyle & Motorsport" maxLength={60}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createCluster(); if (e.key === 'Escape') setAdding(false) }} />
          <Button variant="primary" icon={<Check size={17} />} disabled={!newName.trim()} onClick={createCluster}>Dodaj</Button>
          <IconBtn label="Anuluj" onClick={() => setAdding(false)}><X size={18} /></IconBtn>
        </div>
      )}

      {!visible.length && !adding && (
        <Empty icon={<Shapes size={24} />} title="Firma nie ma jeszcze marek"
          text="Dodaj kategorie (np. klastry holdingu) i marki. Każda marka dostanie własne produkty, stronę, strategię i ton."
          action={<Button variant="accent" icon={<Plus size={18} />} onClick={() => setEditor({})}>Nowa marka</Button>} />
      )}

      <div className="bclus">
        {visible.map((c, ci) => (
          <section key={c.id ?? 'none'} data-id={c.id ?? undefined} className="bclu">
            <header className="bclu__head">
              {renaming === c.id && c.id ? (
                <input className="input bclu__rename" autoFocus value={rename} onChange={(e) => setRename(e.target.value)}
                  onBlur={() => saveRename(c)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <h2>{c.name} <span className="muted">· {c.brands.length}</span></h2>
              )}
              <span className="grow" />
              <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditor({ cluster: c.id })}>Marka</Button>
              {c.id && (
                <Menu trigger={(_, toggle) => <IconBtn label="Kategoria" onClick={toggle}><MoreHorizontal size={18} /></IconBtn>}>
                  {(close) => (
                    <>
                      <MenuItem icon={<PenLine size={17} />} onClick={() => { close(); setRename(c.name); setRenaming(c.id) }}>Zmień nazwę</MenuItem>
                      {ci > 0 && <MenuItem icon={<ArrowUp size={17} />} onClick={() => { close(); moveCluster(c, -1) }}>Wyżej</MenuItem>}
                      {ci < rows.length - 1 && <MenuItem icon={<ArrowDown size={17} />} onClick={() => { close(); moveCluster(c, 1) }}>Niżej</MenuItem>}
                      <MenuItem danger icon={<Trash2 size={17} />} onClick={() => { close(); removeCluster(c) }}>Usuń kategorię</MenuItem>
                    </>
                  )}
                </Menu>
              )}
            </header>
            {c.brands.length === 0 && <p className="muted bclu__empty">Pusta kategoria — dodaj markę albo przenieś tu istniejącą.</p>}
            {c.brands.map((b, bi) => (
              <div key={b.id} data-id={b.id} className="brow">
                <BrandMark brand={b} size={36} />
                <div className="brow__main">
                  <Link to={`/app/kb?b=${b.id}`} className="brow__name">{b.name}<ArrowUpRight size={14} /></Link>
                  <small className="truncate">
                    {[b.aliases.length ? `też: ${b.aliases.join(', ')}` : '', b.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join(' · ') || 'Bez skrótów i strony'}
                  </small>
                </div>
                <select className="select brow__move" value={b.cluster_id ?? ''} onChange={(e) => moveBrand(b, e.target.value || null)} aria-label="Kategoria">
                  <option value="">Bez kategorii</option>
                  {rows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <span className="brow__acts">
                  <IconBtn label="Wyżej" disabled={bi === 0} onClick={() => reorderBrand(c, b, -1)}><ArrowUp size={16} /></IconBtn>
                  <IconBtn label="Niżej" disabled={bi === c.brands.length - 1} onClick={() => reorderBrand(c, b, 1)}><ArrowDown size={16} /></IconBtn>
                  <IconBtn label="Edytuj markę" onClick={() => setEditor({ brand: b })}><PenLine size={16} /></IconBtn>
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      {archived.length > 0 && (
        <section className="bclu bclu--archived">
          <header className="bclu__head"><h2>Archiwum <span className="muted">· {archived.length}</span></h2></header>
          {archived.map((b) => (
            <div key={b.id} data-id={b.id} className="brow">
              <BrandMark brand={b} size={36} />
              <div className="brow__main"><b>{b.name}</b><small>{b.website ? <><Globe size={12} /> {b.website}</> : 'W archiwum'}</small></div>
              <Button size="sm" icon={<ArchiveRestore size={15} />} onClick={() => restore(b)}>Przywróć</Button>
            </div>
          ))}
        </section>
      )}

      <BrandEditor open={!!editor} brand={editor?.brand} defaultCluster={editor?.cluster ?? null}
        onClose={(id) => { setEditor(null); if (id) done(id) }} />
    </Page>
  )
}
