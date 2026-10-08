import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Page } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { Button, copyText, Field, IconBtn, Loading, Tabs, useFeedback } from '../components/ui'
import { useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import type { Brand, FileRow } from '../lib/types'

type Section = 'strategy' | 'identity' | 'tone'

export default function BrandPage() {
  const t = useT()
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
    toast(t('Бренд сохранён. ИИ уже учитывает изменения.', 'Marka zapisana. AI już uwzględnia zmiany.'))
  }

  if ((loading && !data) || !f) return <Loading />
  const area = (key: 'strategy' | 'audience' | 'tone' | 'dos' | 'donts', label: string, hint: string, rows = 5) => (
    <Field label={label} hint={hint}>
      <textarea className="textarea" rows={rows} value={f[key]} readOnly={!canManage} onChange={(e) => set(key, e.target.value)} />
    </Field>
  )

  return (
    <Page className="page--narrow" crumb={<><Link to="/app/kb">{t('База знаний', 'Baza wiedzy')}</Link>/<b>{t('О бренде', 'O marce')}</b></>}>
      <div className="page__head">
        <div>
          <h1>{t('О бренде', 'O marce')}</h1>
          <p>{t('Отсюда ИИ берёт характер и правила: как звучать, для кого писать и как выглядеть.', 'Stąd AI bierze charakter i zasady: jak brzmieć, dla kogo pisać i jak wyglądać.')}</p>
        </div>
        {canManage && <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>{t('Сохранить', 'Zapisz')}</Button>}
      </div>
      <Tabs value={section} onChange={(s) => nav(`/app/brand/${s}`)} tabs={[
        { value: 'strategy', label: t('Стратегия', 'Strategia') },
        { value: 'identity', label: t('Айдентика', 'Identyfikacja') },
        { value: 'tone', label: 'Tone of voice' },
      ]} />

      <div className="form brand">
        {section === 'strategy' && (
          <>
            <Field label={t('Слоган', 'Hasło')}><input className="input" value={f.tagline} readOnly={!canManage} onChange={(e) => set('tagline', e.target.value)} /></Field>
            {area('strategy', t('Стратегия и позиционирование', 'Strategia i pozycjonowanie'), t('Кто мы, что делаем и чем отличаемся.', 'Kim jesteśmy, co robimy i czym się wyróżniamy.'), 7)}
            {area('audience', t('Аудитория', 'Odbiorcy'), t('Для кого продукты и что этим людям важно.', 'Dla kogo są produkty i co jest dla tych ludzi ważne.'))}
          </>
        )}

        {section === 'identity' && (
          <>
            <div className="field">
              <span className="field__label">{t('Цвета', 'Kolory')}</span>
              <div className="swatches">
                {f.colors.map((c, i) => (
                  <div key={i} className="swatch">
                    <label className="swatch__chip" style={{ background: c.hex }}>
                      {canManage && <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#000000'} onChange={(e) => set('colors', f.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value.toUpperCase() } : x)))} />}
                    </label>
                    <input className="swatch__name" value={c.name} readOnly={!canManage} placeholder={t('Название', 'Nazwa')} onChange={(e) => set('colors', f.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <button type="button" className="swatch__hex" onClick={async () => (await copyText(c.hex)) && toast(`${c.hex} — ${t('скопировано', 'skopiowano')}`)}>{c.hex}</button>
                    {canManage && <IconBtn label={t('Удалить', 'Usuń')} onClick={() => set('colors', f.colors.filter((_, j) => j !== i))}><Trash2 size={15} /></IconBtn>}
                  </div>
                ))}
                {canManage && <button type="button" className="swatch swatch--add" onClick={() => set('colors', [...f.colors, { name: '', hex: '#FDADA4' }])}><Plus size={20} />{t('Цвет', 'Kolor')}</button>}
              </div>
            </div>
            <div className="field">
              <span className="field__label">{t('Шрифты', 'Fonty')}</span>
              <div className="fonts">
                {f.fonts.map((font, i) => (
                  <div key={i} className="fonts__row">
                    <input className="input" value={font.role} readOnly={!canManage} placeholder={t('Где используется', 'Gdzie używany')} onChange={(e) => set('fonts', f.fonts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                    <input className="input" value={font.name} readOnly={!canManage} placeholder={t('Название шрифта', 'Nazwa fontu')} onChange={(e) => set('fonts', f.fonts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    {canManage && <IconBtn label={t('Удалить', 'Usuń')} onClick={() => set('fonts', f.fonts.filter((_, j) => j !== i))}><Trash2 size={15} /></IconBtn>}
                  </div>
                ))}
                {canManage && <Button size="sm" icon={<Plus size={15} />} onClick={() => set('fonts', [...f.fonts, { role: '', name: '' }])}>{t('Добавить шрифт', 'Dodaj font')}</Button>}
              </div>
            </div>
            <div className="field">
              <span className="field__label">{t('Логотипы и фирменная графика', 'Logotypy i grafika firmowa')}</span>
              <FileGrid files={data!.files} kind="logo" onChange={reload} accept="image/*,.svg,.pdf,.eps,.ai"
                hint={t('SVG, PNG, PDF — всё, что команда должна брать только отсюда.', 'SVG, PNG, PDF — wszystko, co zespół ma brać tylko stąd.')} />
            </div>
          </>
        )}

        {section === 'tone' && (
          <>
            {area('tone', t('Как мы звучим', 'Jak brzmimy'), t('ИИ пишет тексты в этом тоне.', 'AI pisze teksty w tym tonie.'), 6)}
            <div className="form__row">
              {area('dos', t('Делаем', 'Robimy'), t('По одному правилу в строке', 'Jedna zasada w wierszu'), 6)}
              {area('donts', t('Не делаем', 'Nie robimy'), t('По одному правилу в строке', 'Jedna zasada w wierszu'), 6)}
            </div>
          </>
        )}
      </div>
    </Page>
  )
}
