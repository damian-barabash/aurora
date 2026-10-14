import { useCallback, useState } from 'react'
import { Page, useChanged } from '../app/Shell'
import { useCompany, useQuery } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { BrandSelect } from '../components/kb'
import { Loading, Segmented } from '../components/ui'
import { isImage } from '../lib/files'
import { supabase } from '../lib/supabase'
import type { FileRow } from '../lib/types'

export default function FilesPage() {
  const company = useCompany()
  const [filter, setFilter] = useState<'all' | 'images' | 'docs' | 'unread'>('all')
  // marka nowych plików: podpowiedź dla AI, fakty o innej marce i tak trafią tam, gdzie należą
  const [brand, setBrand] = useState<string | null>(null)
  const { data, loading, reload } = useQuery(async () => {
    const { data: files } = await supabase.from('files').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(300)
    return (files ?? []) as FileRow[]
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))
  if (loading && !data) return <Loading />
  const files = (data ?? []).filter((f) => filter === 'all'
    || (filter === 'unread' ? ['queued', 'reading', 'error'].includes(f.ai_status) : (filter === 'images') === isImage(f)))
  const unread = (data ?? []).filter((f) => ['queued', 'reading', 'error'].includes(f.ai_status)).length
  return (
    <Page crumb="Pliki">
      <div className="page__head">
        <div>
          <h1>Pliki</h1>
          <p>Zdjęcia, logotypy, oferty, briefy i cenniki. Każdy dokument AI czyta od razu po wgraniu i dodaje z niego fakty — przy pliku widać, czy jest przeczytany i co trafiło do bazy.</p>
        </div>
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'Wszystkie' }, { value: 'images', label: 'Zdjęcia' }, { value: 'docs', label: 'Dokumenty' },
          ...(unread ? [{ value: 'unread' as const, label: `Nieprzeczytane · ${unread}` }] : []),
        ]} />
      </div>
      <div className="files__brand">
        <span>Nowe pliki dotyczą marki</span>
        <BrandSelect value={brand} onChange={setBrand} groupLabel="Rozpoznaj automatycznie" />
      </div>
      <FileGrid files={files} onChange={reload} brandId={brand} />
    </Page>
  )
}
