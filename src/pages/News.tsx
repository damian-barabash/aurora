import { Archive, Megaphone, PenLine, Pin, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { emitChanged, Page, useChanged } from '../app/Shell'
import { usePeople } from '../app/people'
import { useCompany, useQuery } from '../app/session'
import { EntryEditor, SourceTag } from '../components/kb'
import { Button, cx, Empty, IconBtn, Loading, Segmented } from '../components/ui'
import { fmtDate, useI18n, useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import type { Entry } from '../lib/types'

export default function NewsPage() {
  const t = useT()
  const { lang } = useI18n()
  const company = useCompany()
  const { names } = usePeople()
  const [filter, setFilter] = useState<'all' | 'important'>('all')
  const [editor, setEditor] = useState<{ entry?: Entry } | null>(null)

  const { data, loading, reload } = useQuery(async () => {
    const [{ data: entries }, { data: products }] = await Promise.all([
      supabase.from('entries').select('*').eq('company_id', company.id).in('type', ['announcement', 'news']).neq('status', 'archived')
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      supabase.from('products').select('id, name').eq('company_id', company.id),
    ])
    return { entries: (entries ?? []) as Entry[], products: Object.fromEntries((products ?? []).map((p) => [p.id, p.name])) as Record<string, string> }
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))

  if (loading && !data) return <Loading />
  const list = (data?.entries ?? []).filter((e) => filter === 'all' || e.importance >= 2)
  const patch = async (e: Entry, values: Partial<Entry>) => {
    await supabase.from('entries').update(values).eq('id', e.id)
    emitChanged()
  }
  const imp = (n: number) => n >= 3 ? t('Срочно', 'Pilne') : n === 2 ? t('Важно', 'Ważne') : null

  return (
    <Page className="page--narrow" crumb={t('Коммуникаты', 'Komunikaty')}>
      <div className="page__head">
        <div>
          <h1>{t('Коммуникаты', 'Komunikaty')}</h1>
          <p>{t('Важные сообщения и новости для всей команды. ИИ сам находит их в почте и оценивает важность; срочное приходит уведомлением.', 'Ważne wiadomości i aktualności dla całego zespołu. AI samo znajduje je w poczcie i ocenia ważność; pilne przychodzą jako powiadomienie.')}</p>
        </div>
        <Button variant="accent" size="lg" icon={<Plus size={20} />} onClick={() => setEditor({})}>{t('Новый коммуникат', 'Nowy komunikat')}</Button>
      </div>
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: t('Все', 'Wszystkie') }, { value: 'important', label: t('Только важные', 'Tylko ważne') }]} />

      <div className="feed">
        {list.length === 0 && <Empty icon={<Megaphone size={24} />} title={t('Коммуникатов пока нет', 'Brak komunikatów')} text={t('Напишите первое сообщение для команды — или подключите почту, и важное появится само.', 'Napisz pierwszą wiadomość dla zespołu — albo podłącz pocztę, a ważne rzeczy pojawią się same.')} />}
        {list.map((e) => (
          <article key={e.id} className={cx('post', e.importance >= 3 && 'post--hot', e.pinned && 'is-pinned')}>
            <div className="post__top">
              <time>{fmtDate(e.effective_from ?? e.created_at, lang)}</time>
              {imp(e.importance) && <span className="post__imp">{imp(e.importance)}</span>}
              {e.pinned && <span className="post__pin"><Pin size={13} />{t('Закреплено', 'Przypięte')}</span>}
              <span className="grow" />
              <IconBtn label={e.pinned ? t('Открепить', 'Odepnij') : t('Закрепить', 'Przypnij')} onClick={() => patch(e, { pinned: !e.pinned })}><Pin size={16} /></IconBtn>
              <IconBtn label={t('Изменить', 'Edytuj')} onClick={() => setEditor({ entry: e })}><PenLine size={16} /></IconBtn>
              <IconBtn label={t('В архив', 'Do archiwum')} onClick={() => patch(e, { status: 'archived' })}><Archive size={16} /></IconBtn>
            </div>
            <h2>{e.title}</h2>
            {e.body && <p>{e.body}</p>}
            <div className="post__meta">
              {e.product_id && data?.products[e.product_id] && <Link to={`/app/kb/${e.product_id}`}>{data.products[e.product_id]}</Link>}
              <SourceTag source={e.source} label={e.source_label} />
              {e.created_by && names[e.created_by] && e.source === 'manual' && <span>{names[e.created_by]}</span>}
            </div>
          </article>
        ))}
      </div>
      <EntryEditor open={!!editor} entry={editor?.entry} preset={{ type: 'announcement', importance: 2 }} onClose={() => setEditor(null)} />
    </Page>
  )
}
