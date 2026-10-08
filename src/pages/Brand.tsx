import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Page } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { Button, copyText, Field, IconBtn, Loading, Tabs, useFeedback } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { Brand, FileRow } from '../lib/types'

type Section = 'strategy' | 'identity' | 'tone'

export default function BrandPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { section = 'strategy' } = useParams() as { section?: Section }
  const nav = useNavigate()
  const { fail, toast } = useFeedback()
  const [f, setF] = useState<Brand | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, loading, reload } = useQuery(async () => {
    const [{ data: brand }, { data: files }] = await Promise.all([
      supabase.from('brand').select('*').eq('company_id', company.id).maybeSingle(),
      supabase.from('files').select('*').eq('company_id', company.id).in('kind', ['logo', 'brand']).order('created_at', { ascending: false }),
    ])
    return { brand: brand as Brand | null, files: (files ?? []) as FileRow[] }
  }, [company.id])

  useEffect(() => {
    if (data && !dirty) {
      setF(data.brand ?? { company_id: company.id, tagline: '', strategy: '', audience: '', tone: '', dos: '', donts: '', colors: [], fonts: [], updated_at: '' })
    }
  }, [data, dirty, company.id])

  const set = useCallback(<K extends keyof Brand>(key: K, value: Brand[K]) => {
    setF((cur) => (cur ? { ...cur, [key]: value } : cur))
    setDirty(true)
  }, [])

  const save = async () => {
    if (!f) return
    setBusy(true)
    const { updated_at: _skip, ...row } = f
    void _skip
    const { error } = await supabase.from('brand').upsert({ ...row, company_id: company.id, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) return fail(error.message)
    setDirty(false)
    toast('Marka zapisana. AI już uwzględnia zmiany.')
  }

  if ((loading && !data) || !f) return <Loading />
  const area = (key: 'strategy' | 'audience' | 'tone' | 'dos' | 'donts', label: string, hint: string, rows = 5) => (
    <Field label={label} hint={hint}>
      <textarea className="textarea" rows={rows} value={f[key]} readOnly={!canManage} onChange={(e) => set(key, e.target.value)} />
    </Field>
  )

  return (
    <Page className="page--narrow" crumb={<><Link to="/app/kb">Baza wiedzy</Link>/<b>O marce</b></>}>
      <div className="page__head">
        <div>
          <h1>O marce</h1>
          <p>Stąd AI bierze charakter i zasady: jak brzmieć, dla kogo pisać i jak wyglądać.</p>
        </div>
        {canManage && <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>Zapisz</Button>}
      </div>
      <Tabs value={section} onChange={(s) => nav(`/app/brand/${s}`)} tabs={[
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
              <FileGrid files={data!.files} kind="logo" onChange={reload} accept="image/*,.svg,.pdf,.eps,.ai"
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
