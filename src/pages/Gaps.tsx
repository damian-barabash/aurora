import { Check, CircleHelp, EyeOff, Plus } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Page } from '../app/Shell'
import { usePeople } from '../app/people'
import { useCompany, useQuery, useSession } from '../app/session'
import { EntryEditor } from '../components/kb'
import { Button, Empty, Loading, Tabs } from '../components/ui'
import { fmtWhen } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Gap {
  id: string
  question: string
  user_id: string | null
  status: 'open' | 'resolved' | 'ignored'
  hits: number
  updated_at: string
}

export default function GapsPage() {
  const company = useCompany()
  const { canManage } = useSession()
  const { names } = usePeople()
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [answer, setAnswer] = useState<Gap | null>(null)
  const { data, loading, reload } = useQuery(async () => {
    const { data: gaps } = await supabase.from('knowledge_gaps').select('*').eq('company_id', company.id).order('hits', { ascending: false }).order('updated_at', { ascending: false }).limit(200)
    return (gaps ?? []) as Gap[]
  }, [company.id])
  if (!canManage) return <Navigate to="/app" replace />
  if (loading && !data) return <Loading />
  const setStatus = async (g: Gap, status: Gap['status']) => {
    await supabase.from('knowledge_gaps').update({ status, updated_at: new Date().toISOString() }).eq('id', g.id)
    reload()
  }
  const open = (data ?? []).filter((g) => g.status === 'open')
  const closed = (data ?? []).filter((g) => g.status !== 'open')
  const list = tab === 'open' ? open : closed
  return (
    <Page className="page--narrow" crumb="Luki w wiedzy">
      <div className="page__head">
        <div>
          <h1>Luki w wiedzy</h1>
          <p>Pytania z czatu, na które w bazie nie znaleziono odpowiedzi. Im częściej pytają — tym wyżej na liście.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Bez odpowiedzi', count: open.length }, { value: 'closed', label: 'Zamknięte', count: closed.length }]} />
      <div className="feed">
        {list.length === 0 && <Empty icon={<CircleHelp size={24} />} title={tab === 'open' ? 'Brak luk' : 'Na razie pusto'} text={tab === 'open' ? 'Na wszystkie pytania zespołu znalazła się odpowiedź w bazie.' : undefined} />}
        {list.map((g) => (
          <article key={g.id} className="gap">
            <span className="gap__hits" title="Ile razy zapytano">{g.hits}×</span>
            <div className="grow">
              <b>{g.question}</b>
              <small className="muted">{g.user_id && names[g.user_id] ? `${names[g.user_id]} · ` : ''}{fmtWhen(g.updated_at)}</small>
            </div>
            {g.status === 'open' ? (
              <>
                <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => setAnswer(g)}>Dodaj odpowiedź</Button>
                <Button size="sm" variant="quiet" icon={<EyeOff size={15} />} onClick={() => setStatus(g, 'ignored')}>Niepotrzebne</Button>
              </>
            ) : <span className="prop__done">{g.status === 'resolved' ? <><Check size={15} />Odpowiedź dodana</> : 'Ukryte'}</span>}
          </article>
        ))}
      </div>
      <EntryEditor open={!!answer} preset={{ title: answer?.question.slice(0, 150), type: 'faq' }} onClose={(saved) => { if (saved && answer) setStatus(answer, 'resolved'); setAnswer(null) }} />
    </Page>
  )
}
