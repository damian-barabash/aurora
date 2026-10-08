import { ArrowRight, ArrowUp, ArrowUpRight, CalendarDays, Megaphone, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Page, useChanged, usePanel } from '../app/Shell'
import { usePeople } from '../app/people'
import { useCompany, useQuery, useSession } from '../app/session'
import { Mark } from '../brand/Logo'
import { HistoryList } from '../components/History'
import { Markdown } from '../components/Markdown'
import { Button, Loading, useFeedback } from '../components/ui'
import { fmtDate, useI18n, useT } from '../lib/i18n'
import { api, supabase } from '../lib/supabase'
import type { Entry, HistoryRow } from '../lib/types'

export default function HomePage() {
  const t = useT()
  const { lang } = useI18n()
  const company = useCompany()
  const { profile, canManage } = useSession()
  const { pending } = usePanel()
  const { names } = usePeople()
  const { fail } = useFeedback()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [digesting, setDigesting] = useState(false)

  const { data, loading, reload } = useQuery(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const [digest, products, entries, mail, news, dates, history] = await Promise.all([
      supabase.from('digests').select('day, content, stats').eq('company_id', company.id).order('day', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('products').select('id, name').eq('company_id', company.id).neq('status', 'archived'),
      supabase.from('entries').select('id', { count: 'exact', head: true }).eq('company_id', company.id).neq('status', 'archived'),
      supabase.from('integrations').select('id', { count: 'exact', head: true }).eq('company_id', company.id).eq('status', 'active'),
      supabase.from('entries').select('*').eq('company_id', company.id).in('type', ['announcement', 'news']).eq('status', 'current')
        .order('pinned', { ascending: false }).order('importance', { ascending: false }).order('created_at', { ascending: false }).limit(3),
      supabase.from('entries').select('*').eq('company_id', company.id).in('status', ['current', 'review']).gte('effective_from', today)
        .order('effective_from').limit(6),
      supabase.from('history').select('*').eq('company_id', company.id).order('created_at', { ascending: false }).limit(8),
    ])
    return {
      digest: digest.data as { day: string; content: string; stats: { changes?: number } } | null,
      products: products.data ?? [],
      entries: entries.count ?? 0,
      mail: mail.count ?? 0,
      news: (news.data ?? []) as Entry[],
      dates: (dates.data ?? []) as Entry[],
      history: (history.data ?? []) as HistoryRow[],
    }
  }, [company.id])
  useChanged(useCallback(() => { reload() }, [reload]))

  if (loading && !data) return <Loading />
  const d = data!
  const hour = new Date().getHours()
  const hello = hour < 5 ? t('Доброй ночи', 'Dobrej nocy') : hour < 12 ? t('Доброе утро', 'Dzień dobry') : hour < 18 ? t('Добрый день', 'Dzień dobry') : t('Добрый вечер', 'Dobry wieczór')
  const first = (profile?.full_name || '').split(' ')[0]
  const productName = Object.fromEntries(d.products.map((p) => [p.id, p.name]))
  const ask = () => q.trim() && nav(`/app/chat?q=${encodeURIComponent(q.trim())}`)
  const makeDigest = async () => {
    setDigesting(true)
    await api('digest_now', { company_id: company.id }).catch(fail)
    await reload()
    setDigesting(false)
  }
  const isToday = d.digest?.day === new Date().toLocaleDateString('en-CA')

  return (
    <Page crumb={t('Сегодня', 'Dzisiaj')}>
      <div className="home__hello">
        <div className="eyebrow">{new Date().toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>{hello}{first ? `, ${first}` : ''}</h1>
      </div>

      <form className="home__ask" onSubmit={(e) => { e.preventDefault(); ask() }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Спросите AURORA о любом продукте, цене или дате…', 'Zapytaj AURORA o dowolny produkt, cenę lub termin…')} />
        <button type="submit" className="composer__send" disabled={!q.trim()} aria-label={t('Спросить', 'Zapytaj')}><ArrowUp size={20} /></button>
      </form>

      <div className="home__grid">
        <section className="digest">
          <div className="digest__head">
            <Mark size={30} />
            <div className="grow">
              <b>{t('Утренний дайджест', 'Poranne podsumowanie')}</b>
              <small>{d.digest ? (isToday ? t('Сегодня', 'Dzisiaj') : fmtDate(d.digest.day, lang)) : t('Собирается каждое утро в 7:00', 'Powstaje codziennie o 7:00')}</small>
            </div>
            {canManage && <Button size="sm" variant="quiet" className="digest__btn" busy={digesting} icon={<RefreshCw size={15} />} onClick={makeDigest}>{t('Обновить', 'Odśwież')}</Button>}
          </div>
          {d.digest?.content
            ? <Markdown text={d.digest.content} />
            : <p className="digest__empty">{t('Пока изменений нет. Как только в базе что-то поменяется — из почты, календаря, Claude или вручную — здесь появится короткая сводка.', 'Na razie brak zmian. Gdy tylko coś zmieni się w bazie — z poczty, kalendarza, Claude lub ręcznie — pojawi się tu krótkie podsumowanie.')}</p>}
        </section>

        <div className="stats">
          <Link to="/app/kb" className="stat"><b>{d.products.length}</b><span>{t('продуктов', 'produktów')}</span><ArrowUpRight size={16} /></Link>
          <Link to="/app/kb" className="stat"><b>{d.entries}</b><span>{t('материалов', 'materiałów')}</span><ArrowUpRight size={16} /></Link>
          <Link to="/app/review" className={`stat${pending ? ' stat--hot' : ''}`}><b>{pending}</b><span>{t('ждут проверки', 'czeka na sprawdzenie')}</span><ArrowUpRight size={16} /></Link>
          <Link to="/app/integrations" className="stat"><b>{d.mail}</b><span>{t('почт подключено', 'skrzynek podłączonych')}</span><ArrowUpRight size={16} /></Link>
        </div>
      </div>

      {d.news.length > 0 && (
        <>
          <h2 className="section-title">{t('Важное', 'Ważne')}<Link to="/app/news">{t('Все коммуникаты', 'Wszystkie komunikaty')}<ArrowRight size={15} /></Link></h2>
          <div className="newsrow">
            {d.news.map((n) => (
              <Link key={n.id} to="/app/news" className={`newscard${n.importance >= 3 ? ' newscard--hot' : ''}`}>
                <span className="newscard__top"><Megaphone size={16} />{fmtDate(n.effective_from ?? n.created_at, lang, false)}</span>
                <b>{n.title}</b>
                <p>{n.body}</p>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="home__cols">
        <section>
          <h2 className="section-title">{t('Последние изменения', 'Ostatnie zmiany')}</h2>
          {d.history.length
            ? <HistoryList compact rows={d.history} people={names} products={productName} />
            : <p className="muted">{t('Изменений пока нет.', 'Brak zmian.')}</p>}
        </section>
        <section>
          <h2 className="section-title">{t('Ближайшие даты', 'Najbliższe terminy')}</h2>
          {d.dates.length ? (
            <div className="dates">
              {d.dates.map((e) => {
                const date = new Date(`${e.effective_from}T12:00:00`)
                return (
                  <Link key={e.id} to={e.product_id ? `/app/kb/${e.product_id}?e=${e.id}` : '/app/news'} className="dates__row">
                    <span className="dates__day"><b>{date.getDate()}</b>{date.toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'ru-RU', { month: 'short' }).replace('.', '')}</span>
                    <span className="grow"><b className="truncate">{e.title}</b><small className="truncate">{e.product_id ? productName[e.product_id] : company.name}</small></span>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="dates__empty"><CalendarDays size={20} /><span>{t('Подключите календарь — даты запусков и событий появятся здесь сами.', 'Podłącz kalendarz — daty premier i wydarzeń pojawią się tu same.')}</span></div>
          )}
        </section>
      </div>
    </Page>
  )
}
