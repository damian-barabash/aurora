import { ArrowUpRight, Globe, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BrandMark, useBrands } from '../app/brands'
import { Page } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { BrandSelect } from '../components/kb'
import { Button, copyText, Field, IconBtn, Loading, Tabs, useFeedback } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { BrandProfile, FileRow } from '../lib/types'

type Section = 'strategy' | 'identity' | 'tone'

export default function BrandPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { byId, group } = useBrands()
  const { section = 'strategy' } = useParams() as { section?: Section }
  const [params] = useSearchParams()
  const raw = params.get('b')
  /** `null` = profil całej grupy */
  const brandId = raw && raw !== 'group' ? raw : null
  const brand = brandId ? byId.get(brandId) ?? null : null
  const scope = brandId ?? 'group'
  const nav = useNavigate()
  const { fail, toast, confirm } = useFeedback()
  const [f, setF] = useState<BrandProfile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, loading, reload } = useQuery(async () => {
    let profile = supabase.from('brand').select('*').eq('company_id', company.id)
    let files = supabase.from('files').select('*').eq('company_id', company.id).in('kind', ['logo', 'brand'])
    profile = brandId ? profile.eq('brand_id', brandId) : profile.is('brand_id', null)
    files = brandId ? files.eq('brand_id', brandId) : files.is('brand_id', null)
    const [{ data: row }, { data: list }] = await Promise.all([profile.maybeSingle(), files.order('created_at', { ascending: false })])
    return { brand: row as BrandProfile | null, files: (list ?? []) as FileRow[] }
  }, [company.id, brandId])

  useEffect(() => {
    setDirty(false)
  }, [brandId])
  useEffect(() => {
    if (data && !dirty) {
      setF(data.brand ?? { company_id: company.id, brand_id: brandId, tagline: '', strategy: '', audience: '', tone: '', dos: '', donts: '', colors: [], fonts: [], updated_at: '' })
    }
  }, [data, dirty, company.id, brandId])

  const set = useCallback(<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => {
    setF((cur) => (cur ? { ...cur, [key]: value } : cur))
    setDirty(true)
  }, [])

  const save = async () => {
    if (!f) return
    setBusy(true)
    const { updated_at: _skip, id, ...row } = f
    void _skip
    const values = { ...row, company_id: company.id, brand_id: brandId, updated_at: new Date().toISOString() }
    const { error } = id
      ? await supabase.from('brand').update(values).eq('id', id)
      : await supabase.from('brand').insert(values)
    setBusy(false)
    if (error) return fail(error.message)
    setDirty(false)
    reload()
    toast(`${brand?.name ?? 'Profil grupy'} — zapisano. AI już uwzględnia zmiany.`)
  }

  if ((loading && !data) || !f) return <Loading />
  const area = (key: 'strategy' | 'audience' | 'tone' | 'dos' | 'donts', label: string, hint: string, rows = 5) => (
    <Field label={label} hint={hint}>
      <textarea className="textarea" rows={rows} value={f[key]} readOnly={!canManage} onChange={(e) => set(key, e.target.value)} />
    </Field>
  )

  return (
    <Page className="page--narrow" crumb={<><Link to="/app/kb">Baza wiedzy</Link>/<Link to={`/app/kb?b=${scope}`}>{brand?.name ?? group}</Link>/<b>O marce</b></>}>
      <div className="page__head">
        <div>
          <h1>{brand ? brand.name : `${group} — profil grupy`}</h1>
          <p>{brand
            ? 'Stąd AI bierze charakter tej marki: jak brzmieć, dla kogo pisać i jak wyglądać. Zasady grupy obowiązują dodatkowo.'
            : 'Zasady wspólne dla wszystkich marek. AI łączy je z profilem konkretnej marki.'}</p>
        </div>
        {canManage && <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>Zapisz</Button>}
      </div>
      <div className="brandpick">
        <BrandMark brand={brand} group={group} size={40} />
        <BrandSelect value={brandId} groupLabel={`${group} — profil grupy`} onChange={async (id) => {
          if (dirty && !(await confirm({ title: 'Niezapisane zmiany', text: 'Przejść do innej marki bez zapisywania?', action: 'Przejdź' }))) return
          nav(`/app/brand/${section}?b=${id ?? 'group'}`)
        }} />
        {brand?.website && <a className="btn btn--quiet" href={brand.website} target="_blank" rel="noreferrer"><Globe size={16} /><span>Strona</span></a>}
        <Link className="btn btn--quiet" to={`/app/kb?b=${scope}`}><span>Produkty i wiedza</span><ArrowUpRight size={16} /></Link>
      </div>
      <Tabs value={section} onChange={(s) => nav(`/app/brand/${s}?b=${scope}`)} tabs={[
        { value: 'strategy', label: 'Strategia' },
        { value: 'identity', label: 'Identyfikacja' },
        { value: 'tone', label: 'Tone of voice' },
      ]} />

      <div className="form brand">
        {section === 'strategy' && (
          <>
            <Field label="Hasło"><input className="input" value={f.tagline} readOnly={!canManage} onChange={(e) => set('tagline', e.target.value)} /></Field>
            {area('strategy', 'Strategia i pozycjonowanie', 'Kim jesteśmy, co robimy i czym się wyróżniamy.', 7)}
            {area('audience', 'Odbiorcy', 'Dla kogo są produkty i co jest dla tych ludzi ważne.')}
          </>
        )}

        {section === 'identity' && (
          <>
            <div className="field">
              <span className="field__label">Kolory</span>
              <div className="swatches">
                {f.colors.map((c, i) => (
                  <div key={i} className="swatch">
                    <label className="swatch__chip" style={{ background: c.hex }}>
                      {canManage && <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#000000'} onChange={(e) => set('colors', f.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value.toUpperCase() } : x)))} />}
                    </label>
                    <input className="swatch__name" value={c.name} readOnly={!canManage} placeholder="Nazwa" onChange={(e) => set('colors', f.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <button type="button" className="swatch__hex" onClick={async () => (await copyText(c.hex)) && toast(`${c.hex} — ${'skopiowano'}`)}>{c.hex}</button>
                    {canManage && <IconBtn label="Usuń" onClick={() => set('colors', f.colors.filter((_, j) => j !== i))}><Trash2 size={15} /></IconBtn>}
                  </div>
                ))}
                {canManage && <button type="button" className="swatch swatch--add" onClick={() => set('colors', [...f.colors, { name: '', hex: '#FDADA4' }])}><Plus size={20} />Kolor</button>}
              </div>
            </div>
            <div className="field">
              <span className="field__label">Fonty</span>
              <div className="fonts">
                {f.fonts.map((font, i) => (
                  <div key={i} className="fonts__row">
                    <input className="input" value={font.role} readOnly={!canManage} placeholder="Gdzie używany" onChange={(e) => set('fonts', f.fonts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                    <input className="input" value={font.name} readOnly={!canManage} placeholder="Nazwa fontu" onChange={(e) => set('fonts', f.fonts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    {canManage && <IconBtn label="Usuń" onClick={() => set('fonts', f.fonts.filter((_, j) => j !== i))}><Trash2 size={15} /></IconBtn>}
                  </div>
                ))}
                {canManage && <Button size="sm" icon={<Plus size={15} />} onClick={() => set('fonts', [...f.fonts, { role: '', name: '' }])}>Dodaj font</Button>}
              </div>
            </div>
            <div className="field">
              <span className="field__label">Logotypy i grafika firmowa</span>
              <FileGrid files={data!.files} kind="logo" brandId={brandId} onChange={reload} accept="image/*,.svg,.pdf,.eps,.ai"
                hint="SVG, PNG, PDF — wszystko, co zespół ma brać tylko stąd." />
            </div>
          </>
        )}

        {section === 'tone' && (
          <>
            {area('tone', 'Jak brzmimy', 'AI pisze teksty w tym tonie.', 6)}
            <div className="form__row">
              {area('dos', 'Robimy', 'Jedna zasada w wierszu', 6)}
              {area('donts', 'Nie robimy', 'Jedna zasada w wierszu', 6)}
            </div>
          </>
        )}
      </div>
    </Page>
  )
}
