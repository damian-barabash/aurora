import { useCallback, useState } from 'react'
import { Page, useChanged } from '../app/Shell'
import { useCompany, useQuery } from '../app/session'
import { FileGrid } from '../components/FileGrid'
import { Loading, Segmented } from '../components/ui'
import { isImage } from '../lib/files'
import { useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import type { FileRow } from '../lib/types'

export default function FilesPage() {
  const t = useT()
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
    <Page crumb={t('Файлы', 'Pliki')}>
      <div className="page__head">
        <div>
          <h1>{t('Файлы', 'Pliki')}</h1>
          <p>{t('Фото продуктов, логотипы, оферты и прайсы. Нажмите на искру у документа — ИИ прочитает его и добавит факты в базу знаний.', 'Zdjęcia produktów, logotypy, oferty i cenniki. Kliknij iskrę przy dokumencie — AI przeczyta go i doda fakty do bazy wiedzy.')}</p>
        </div>
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: t('Все', 'Wszystkie') }, { value: 'images', label: t('Фото', 'Zdjęcia') }, { value: 'docs', label: t('Документы', 'Dokumenty') },
        ]} />
      </div>
      <FileGrid files={files} onChange={reload} />
    </Page>
  )
}
