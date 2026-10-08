import { useCallback, useState } from 'react'
import { Page, useChanged } from '../app/Shell'
import { useCompany, useQuery } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { Loading, Segmented } from '../components/ui'
import { isImage } from '../lib/files'
import { supabase } from '../lib/supabase'
import type { FileRow } from '../lib/types'

export default function FilesPage() {
  const company = useCompany()
  const [filter, setFilter] = useState<'all' | 'images' | 'docs'>('all')
  const { data, loading, reload } = useQuery(async () => {
    const { data: files } = await supabase.from('files').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(300)
    return (files ?? []) as FileRow[]
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))
  if (loading && !data) return <Loading />
  const files = (data ?? []).filter((f) => filter === 'all' || (filter === 'images') === isImage(f))
  return (
    <Page crumb="Pliki">
      <div className="page__head">
        <div>
          <h1>Pliki</h1>
          <p>Zdjęcia produktów, logotypy, oferty i cenniki. Kliknij iskrę przy dokumencie — AI przeczyta go i doda fakty do bazy wiedzy.</p>
        </div>
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'Wszystkie' }, { value: 'images', label: 'Zdjęcia' }, { value: 'docs', label: 'Dokumenty' },
        ]} />
      </div>
      <FileGrid files={files} onChange={reload} />
    </Page>
  )
}
