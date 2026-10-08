import { ArrowUp, BookOpen, CalendarDays, MoreHorizontal, PenLine, Pin, PinOff, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Page, usePanel } from '../app/Shell'
import { useCompany } from '../app/session'
import { AppIcon, Mark } from '../brand/Logo'
import { EntryEditor } from '../components/kb'
import { Markdown } from '../components/Markdown'
import { cx, IconBtn, Menu, MenuItem, useFeedback } from '../components/ui'
import { streamChat, supabase, type ChatSource } from '../lib/supabase'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: ChatSource[]
  gap?: boolean
  pending?: boolean
}

export default function ChatPage() {
  const company = useCompany()
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { chats, reloadChats } = usePanel()
  const { fail, confirm } = useFeedback()
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [useContext, setUseContext] = useState(true)
  const [addFor, setAddFor] = useState<string | null>(null)
  const justCreated = useRef<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const chat = chats.find((c) => c.id === id)

  useEffect(() => {
    if (!id) return setMessages([])
    if (justCreated.current === id) return
    supabase.from('chat_messages').select('id, role, content, sources').eq('chat_id', id).order('created_at').then(({ data }) => {
      setMessages((data ?? []) as Msg[])
    })
  }, [id])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])
  useEffect(() => {
    input.current?.focus()
  }, [id])

  const send = useCallback(async (raw: string) => {
    const message = raw.trim()
    if (!message || busy) return
    setBusy(true)
    setText('')
    const tmp = `tmp-${Date.now()}`
    setMessages((list) => [...list, { id: `${tmp}-u`, role: 'user', content: message, sources: [] }, { id: tmp, role: 'assistant', content: '', sources: [], pending: true }])
    const patch = (fn: (m: Msg) => Msg) => setMessages((list) => list.map((m) => (m.id === tmp ? fn(m) : m)))
    try {
      await streamChat({ company_id: company.id, chat_id: id, message, use_context: useContext }, {
        meta(m) {
          if (!id) {
            justCreated.current = m.chat_id
            nav(`/app/chat/${m.chat_id}`, { replace: true })
            reloadChats()
          }
        },
        delta: (piece) => patch((m) => ({ ...m, content: m.content + piece })),
        done: (d) => patch((m) => ({ ...m, pending: false, gap: d.gap, sources: d.sources })),
      })
    } catch (e) {
      fail(e)
      patch((m) => ({ ...m, pending: false, content: m.content || 'Nie udało się uzyskać odpowiedzi. Spróbuj ponownie.' }))
    }
    patch((m) => ({ ...m, pending: false }))
    setBusy(false)
    reloadChats()
  }, [busy, company.id, id, useContext, nav, reloadChats, fail])

  // вопрос, переданный с главной: /app/chat?q=…
  useEffect(() => {
    const q = params.get('q')
    if (!q || id) return
    params.delete('q')
    setParams(params, { replace: true })
    send(q)
  }, [params, setParams, id, send])

  const togglePin = async () => {
    if (!chat) return
    await supabase.from('chats').update({ pinned: !chat.pinned, updated_at: chat.updated_at }).eq('id', chat.id)
    reloadChats()
  }
  const rename = async () => {
    if (!chat) return
    const title = prompt('Nazwa czatu', chat.title)?.trim()
    if (!title) return
    await supabase.from('chats').update({ title, updated_at: chat.updated_at }).eq('id', chat.id)
    reloadChats()
  }
  const remove = async () => {
    if (!chat || !(await confirm({ title: 'Usunąć czat?', text: chat.title, action: 'Usuń', danger: true }))) return
    await supabase.from('chats').delete().eq('id', chat.id)
    await reloadChats()
    nav('/app/chat')
  }

  const quick = [
    { icon: <Sparkles size={18} />, label: 'Co nowego?', q: 'Co ostatnio zmieniło się w bazie wiedzy? Wymień najważniejsze.' },
    { icon: <BookOpen size={18} />, label: 'Przegląd produktów', q: 'Zrób krótki przegląd wszystkich naszych produktów.' },
    { icon: <CalendarDays size={18} />, label: 'Najbliższe terminy', q: 'Jakie są najbliższe terminy i wydarzenia produktów?' },
    { icon: <PenLine size={18} />, label: 'Napisz tekst', fill: 'Napisz krótki post o produkcie ' },
  ]

  const composer = (
    <div className="composer">
      <textarea
        ref={input} rows={2} value={text} placeholder="Zapytaj o produkty, ceny, terminy albo opisz zadanie…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send(text)
          }
        }}
      />
      <div className="composer__bar">
        <span className="composer__model"><b>AURORA</b> Auto</span>
        <i className="composer__sep" />
        <button type="button" className={cx('ctoggle', useContext && 'is-on')} onClick={() => setUseContext(!useContext)}
          title="Odpowiadaj na podstawie bazy wiedzy firmy">
          <BookOpen size={17} />Baza wiedzy
        </button>
        <span className="grow" />
        <button type="button" className="composer__send" disabled={!text.trim() || busy} onClick={() => send(text)} aria-label="Wyślij">
          <ArrowUp size={20} />
        </button>
      </div>
    </div>
  )

  return (
    <Page className="chat" crumb={chat ? <><Link to="/app/chat">Czaty</Link>/<b>{chat.title}</b></> : 'Nowa rozmowa'}>
      {messages.length === 0 ? (
        <div className="chat__hero">
          <div className="chat__intro">
            <AppIcon size={104} className="chat__icon" />
            <div className="eyebrow">Sztab wiedzy · {company.name}</div>
            <h1>Od czego zaczniemy?</h1>
            <p>Zapytaj o produkt, cenę lub termin. AURORA odpowie na podstawie bazy wiedzy i pokaże źródła.</p>
          </div>
          <div className="chat__bottom">
            <div className="chat__quick">
              {quick.map((q) => (
                <button key={q.label} type="button" className="btn btn--ghost" onClick={() => {
                  if (q.q) send(q.q)
                  else {
                    setText(q.fill!)
                    input.current?.focus()
                  }
                }}>{q.icon}<span>{q.label}</span></button>
              ))}
            </div>
            {composer}
            <div className="chat__hint"><span>Tylko wspólna wiedza firmy. Prywatna korespondencja tu nie trafia.</span><span>Enter — wyślij</span></div>
          </div>
        </div>
      ) : (
        <div className="chat__room">
          {chat && (
            <div className="chat__tools">
              <Menu trigger={(_, toggle) => <IconBtn label="Akcje" onClick={toggle}><MoreHorizontal size={18} /></IconBtn>}>
                {(close) => (
                  <>
                    <MenuItem icon={chat.pinned ? <PinOff size={17} /> : <Pin size={17} />} onClick={() => { close(); togglePin() }}>{chat.pinned ? 'Odepnij' : 'Przypnij'}</MenuItem>
                    <MenuItem icon={<PenLine size={17} />} onClick={() => { close(); rename() }}>Zmień nazwę</MenuItem>
                    <MenuItem danger icon={<Trash2 size={17} />} onClick={() => { close(); remove() }}>Usuń</MenuItem>
                  </>
                )}
              </Menu>
            </div>
          )}
          <div className="chat__scroll" ref={scroller}>
            <div className="chat__col">
              {messages.map((m, i) => m.role === 'user' ? (
                <div key={m.id} className="msg msg--user"><div className="msg__bubble">{m.content}</div></div>
              ) : (
                <div key={m.id} className="msg msg--ai">
                  <span className="msg__ava"><Mark size={15} /></span>
                  <div className="msg__body">
                    {m.content ? <Markdown text={m.content} /> : <span className="typing"><i /><i /><i /></span>}
                    {!m.pending && m.sources?.length > 0 && (
                      <div className="msg__sources">
                        {m.sources.map((s) => (
                          <Link key={s.n} to={s.product_id ? `/app/kb/${s.product_id}?e=${s.id}` : '/app/news'} className="srcchip">
                            <b>{s.n}</b><span className="truncate">{s.product ? `${s.product} · ` : ''}{s.title}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                    {m.gap && (
                      <div className="msg__gap">
                        <span>Tego jeszcze nie ma w bazie wiedzy. Pytanie zapisano w „Lukach w wiedzy”.</span>
                        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAddFor(messages[i - 1]?.content ?? '')}><Plus size={15} /><span>Dodaj odpowiedź</span></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="chat__dock">{composer}</div>
        </div>
      )}
      <EntryEditor open={addFor !== null} onClose={() => setAddFor(null)} preset={{ title: (addFor ?? '').slice(0, 150) }} />
    </Page>
  )
}
