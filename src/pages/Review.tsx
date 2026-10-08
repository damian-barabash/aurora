import { Check, GitCompareArrows, Inbox, PenLine, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { emitChanged, Page, useChanged } from '../app/Shell'
import { useCompany, useQuery, useSession } from '../app/session'
import { SourceTag, useTypeLabels } from '../components/kb'
import { Badge, Button, Empty, Field, Loading, Modal, Tabs, useFeedback } from '../components/ui'
import { fmtDate, fmtWhen, useI18n, useT } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'
import type { Entry, Proposal } from '../lib/types'

export default function ReviewPage() {
  const t = useT()
  const { lang } = useI18n()
  const company = useCompany()
  const { canManage } = useSession()
  const types = useTypeLabels()
  const { fail, toast } = useFeedback()
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Proposal | null>(null)
  const [draft, setDraft] = useState({ title: '', body: '', effective_from: '' })

  const { data, loading, reload } = useQuery(async () => {
    const { data: proposals } = await supabase.from('proposals').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(120)
    const list = (proposals ?? []) as Proposal[]
    const entryIds = [...new Set(list.map((p) => p.entry_id).filter(Boolean))] as string[]
    const [{ data: entries }, { data: products }] = await Promise.all([
      entryIds.length ? supabase.from('entries').select('*').in('id', entryIds) : Promise.resolve({ data: [] }),
      supabase.from('products').select('id, name').eq('company_id', company.id),
    ])
    return {
      list,
      entries: Object.fromEntries(((entries ?? []) as Entry[]).map((e) => [e.id, e])) as Record<string, Entry>,
      products: Object.fromEntries((products ?? []).map((p) => [p.id, p.name])) as Record<string, string>,
    }
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))

  const act = async (p: Proposal, action: 'proposal_apply' | 'proposal_reject', edits?: Record<string, unknown>) => {
    setBusy(p.id)
    try {
      await api(action, { id: p.id, edits })
      toast(action === 'proposal_apply' ? t('База знаний обновлена', 'Baza wiedzy zaktualizowana') : p.kind === 'conflict' ? t('Оставлено как в базе', 'Zostawiono jak w bazie') : t('Отклонено', 'Odrzucono'))
      emitChanged()
    } catch (e) {
      fail(e)
    }
    setBusy(null)
  }

  if (loading && !data) return <Loading />
  const pending = (data?.list ?? []).filter((p) => p.status === 'pending')
  const done = (data?.list ?? []).filter((p) => p.status !== 'pending')
  const list = tab === 'pending' ? pending : done
  const kindLabel = (p: Proposal) => p.kind === 'conflict' ? t('Конфликт источников', 'Konflikt źródeł') : p.kind === 'update' ? t('Изменение', 'Zmiana') : p.kind === 'new_product' ? t('Новый продукт', 'Nowy produkt') : t('Новая запись', 'Nowy wpis')

  return (
    <Page className="page--narrow" crumb={t('Проверка', 'Do sprawdzenia')}>
      <div className="page__head">
        <div>
          <h1>{t('Требуют проверки', 'Do sprawdzenia')}</h1>
          <p>{canManage
            ? t('Сюда попадает то, в чём ИИ не уверен: неподтверждённые изменения, новые продукты и противоречия между источниками. Подтверждённое применяется само.', 'Trafia tu to, czego AI nie jest pewne: niepotwierdzone zmiany, nowe produkty i sprzeczności między źródłami. Potwierdzone stosuje się samo.')
            : t('Здесь ваши предложения изменений — из вашей почты и Claude. Решите, что из этого попадёт в общую базу.', 'Tu są Twoje propozycje zmian — z Twojej poczty i Claude. Zdecyduj, co trafi do wspólnej bazy.')}</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: t('Ждут решения', 'Czekają na decyzję'), count: pending.length },
        { value: 'done', label: t('Разобранные', 'Rozpatrzone'), count: done.length },
      ]} />

      <div className="feed">
        {list.length === 0 && <Empty icon={<Inbox size={24} />} title={tab === 'pending' ? t('Всё разобрано', 'Wszystko rozpatrzone') : t('Пока пусто', 'Na razie pusto')}
          text={tab === 'pending' ? t('Новые предложения появятся, когда ИИ найдёт изменения в почте, календаре, на сайте или в разговоре с Claude.', 'Nowe propozycje pojawią się, gdy AI znajdzie zmiany w poczcie, kalendarzu, na stronie lub w rozmowie z Claude.') : undefined} />}
        {list.map((p) => {
          const old = p.entry_id ? data?.entries[p.entry_id] : null
          return (
            <article key={p.id} className={`prop${p.kind === 'conflict' ? ' prop--conflict' : ''}`}>
              <div className="prop__top">
                <Badge tone={p.kind === 'conflict' ? 'accent' : 'neutral'} icon={p.kind === 'conflict' ? <GitCompareArrows size={14} /> : undefined}>{kindLabel(p)}</Badge>
                <SourceTag source={p.source} label={p.source_label} />
                <span className="grow" />
                <time className="muted">{fmtWhen(p.created_at, lang)}</time>
              </div>
              {(p.product_id && data?.products[p.product_id]) || p.payload.new_product ? (
                <div className="prop__product">
                  {p.product_id ? <Link to={`/app/kb/${p.product_id}`}>{data?.products[p.product_id]}</Link> : <><b>{p.payload.new_product!.name}</b> — {p.payload.new_product!.summary}</>}
                </div>
              ) : null}

              {old && (p.kind === 'conflict' || p.kind === 'update') ? (
                <div className="versus">
                  <div><small>{t('Сейчас в базе', 'Teraz w bazie')}</small><b>{old.title}</b><p>{old.body}</p></div>
                  <div className="versus__new"><small>{t('Новая версия', 'Nowa wersja')}</small><b>{p.payload.title}</b><p>{p.payload.body}</p></div>
                </div>
              ) : (
                <div className="prop__body"><small className="eyebrow">{types[p.payload.type] ?? p.payload.type}</small><b>{p.payload.title}</b><p>{p.payload.body}</p></div>
              )}
              <div className="prop__meta">
                {p.payload.effective_from && <span>{t('действует с', 'obowiązuje od')} {fmtDate(p.payload.effective_from, lang)}</span>}
                {p.confidence != null && <span>{t('уверенность', 'pewność')} {Math.round(p.confidence * 100)}%</span>}
              </div>
              {p.evidence && <p className="prop__why">{p.evidence}</p>}

              {p.status === 'pending' ? (
                <div className="prop__acts">
                  <Button variant="primary" icon={<Check size={17} />} busy={busy === p.id} onClick={() => act(p, 'proposal_apply')}>
                    {p.kind === 'conflict' ? t('Принять новую версию', 'Przyjmij nową wersję') : t('Применить', 'Zastosuj')}
                  </Button>
                  <Button icon={<PenLine size={16} />} onClick={() => { setEditing(p); setDraft({ title: p.payload.title, body: p.payload.body, effective_from: p.payload.effective_from ?? '' }) }}>{t('Изменить и применить', 'Zmień i zastosuj')}</Button>
                  <Button variant="quiet" icon={<X size={16} />} disabled={busy === p.id} onClick={() => act(p, 'proposal_reject')}>
                    {p.kind === 'conflict' ? t('Оставить как в базе', 'Zostaw jak w bazie') : t('Отклонить', 'Odrzuć')}
                  </Button>
                </div>
              ) : (
                <div className="prop__done">{p.status === 'applied' ? <><Check size={15} />{t('Применено', 'Zastosowano')}</> : <><X size={15} />{t('Отклонено', 'Odrzucono')}</>}</div>
              )}
            </article>
          )
        })}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} width={580} title={t('Поправьте перед применением', 'Popraw przed zastosowaniem')}
        footer={<><Button onClick={() => setEditing(null)}>{t('Отмена', 'Anuluj')}</Button><Button variant="primary" disabled={!draft.title.trim()} onClick={() => { const p = editing!; setEditing(null); act(p, 'proposal_apply', { ...draft, effective_from: draft.effective_from || null }) }}>{t('Применить', 'Zastosuj')}</Button></>}>
        <div className="form">
          <Field label={t('Заголовок', 'Tytuł')}><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label={t('Содержание', 'Treść')}><textarea className="textarea" rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
          <Field label={t('Действует с', 'Obowiązuje od')}><input type="date" className="input" value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} /></Field>
        </div>
      </Modal>
    </Page>
  )
}
