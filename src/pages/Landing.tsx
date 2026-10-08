import {
  ArrowUpRight, Bell, Bot, Calendar, CircleHelp, EyeOff, FileText, GitCompareArrows, Globe, History, Lock, Mail,
  MessageSquare, Palette, ShieldCheck, Sunrise, UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../app/session'
import { AppIcon, Mark, Pattern, Wordmark } from '../brand/Logo'
import '../styles/landing.css'

function useReveal() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const els = root.current?.querySelectorAll('.rv') ?? []
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return root
}

const SCREENS: { id: string; tab: string; title: string; text: string }[] = [
  { id: 'home', tab: 'Dzisiaj', title: 'Poranek zaczyna się od podsumowania', text: 'Co zmieniło się w bazie od wczoraj, ile rzeczy czeka na decyzję i jakie terminy są najbliżej.' },
  { id: 'kb', tab: 'Baza wiedzy', title: 'Wszystkie produkty w jednym katalogu', text: 'Kolekcje, statusy „Aktualne” i „Sprawdź”, wyszukiwarka oraz liczba materiałów przy każdym produkcie.' },
  { id: 'product', tab: 'Produkt', title: 'Karta produktu: ceny, terminy, fakty', text: 'Każdy wpis ma źródło i datę. Produkt ma osobę odpowiedzialną, a zespół może go obserwować.' },
  { id: 'chat', tab: 'Czat', title: 'Odpowiedź z numerem źródła', text: 'AURORA odpowiada tylko na podstawie bazy wiedzy firmy. Gdy czegoś nie wie — mówi o tym wprost.' },
  { id: 'review', tab: 'Do sprawdzenia', title: 'Konflikt źródeł: która wersja jest właściwa', text: 'W mailu inna cena niż w bazie? Jedna karta, dwie wersje obok siebie i jedno kliknięcie.' },
  { id: 'history', tab: 'Machina czasu', title: 'Pełna historia każdego faktu', text: 'Kto, kiedy i skąd wprowadził zmianę. Było → jest, a poprzednią wersję przywracasz jednym przyciskiem.' },
  { id: 'news', tab: 'Komunikaty', title: 'Ważne wiadomości dla całego zespołu', text: 'AI ocenia ważność, pilne przypina na górze i wysyła powiadomienie.' },
  { id: 'brand', tab: 'Marka', title: 'Kolory, fonty i logotypy w jednym miejscu', text: 'Identyfikacja, strategia i tone of voice — z tego korzysta zespół i AI, gdy pisze teksty.' },
  { id: 'integrations', tab: 'Integracje', title: 'Claude podłączony w trzech krokach', text: 'Osobisty link do serwera MCP, instrukcja krok po kroku oraz import wiedzy ze strony firmy.' },
]

/** Galeria prawdziwych ekranów panelu: zakładki, automatyczna zmiana co kilka sekund do pierwszego kliknięcia. */
function Showcase() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!auto || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let visible = false
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { threshold: 0.35 })
    if (box.current) io.observe(box.current)
    const timer = setInterval(() => visible && setActive((i) => (i + 1) % SCREENS.length), 4500)
    return () => {
      clearInterval(timer)
      io.disconnect()
    }
  }, [auto])
  const screen = SCREENS[active]
  return (
    <div className="lp-show rv" ref={box}>
      <div className="lp-show__tabs" role="tablist">
        {SCREENS.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === active} className={i === active ? 'is-on' : ''} onClick={() => { setActive(i); setAuto(false) }}>{s.tab}</button>
        ))}
      </div>
      <div className="lp-show__cap" key={screen.id}>
        <h3>{screen.title}</h3>
        <p>{screen.text}</p>
      </div>
      <div className="lp-show__frame">
        {SCREENS.map((s, i) => (
          <img key={s.id} src={`/lp/${s.id}.webp`} alt={`AURORA — ${s.tab}`} width={2720} height={1720} loading="lazy" className={i === active ? 'is-on' : ''} />
        ))}
      </div>
    </div>
  )
}

export default function Landing() {
  const { session } = useSession()
  const root = useReveal()
  const enter = session ? '/app' : '/login'
  const enterLabel = session ? 'Otwórz panel' : 'Zaloguj się'

  useEffect(() => {
    document.title = 'AURORA — baza wiedzy firmy, która aktualizuje się sama'
  }, [])

  const steps: [string, string, string, ReactNode[]][] = [
    ['01', 'Zbiera', 'Poczta i kalendarz pracowników, strona firmy, dokumenty i rozmowy z Claude. Każdy podłącza swoje źródła jednym kliknięciem.',
      [<Mail key="m" size={18} />, <Calendar key="c" size={18} />, <Globe key="g" size={18} />, <FileText key="f" size={18} />, <Bot key="b" size={18} />]],
    ['02', 'Sprawdza', 'AI oddziela fakty o produktach od prywatnych spraw. Potwierdzona zmiana trafia od razu do bazy, sporna — czeka na decyzję człowieka.',
      [<ShieldCheck key="s" size={18} />, <GitCompareArrows key="g" size={18} />, <EyeOff key="e" size={18} />]],
    ['03', 'Odpowiada', 'Zapytaj na czacie albo prosto w Claude — dostaniesz odpowiedź ze źródłami. A rano przyjdzie podsumowanie tego, co się zmieniło.',
      [<MessageSquare key="m" size={18} />, <Bot key="b" size={18} />, <Sunrise key="s" size={18} />]],
  ]

  const features: { icon: ReactNode; title: string; text: string; wide?: boolean; dark?: boolean; accent?: boolean }[] = [
    { icon: <MessageSquare size={22} />, wide: true, title: 'Czat, który nie zmyśla', text: 'Odpowiedzi tylko na podstawie bazy wiedzy firmy, z numerami źródeł. Jeśli odpowiedzi nie ma — AURORA to powie i zapisze pytanie w „Lukach”.' },
    { icon: <Mail size={22} />, accent: true, title: 'Poczta jednym kliknięciem', text: 'Nowa cena w mailu szefa — i karta produktu jest już zaktualizowana.' },
    { icon: <Bot size={22} />, dark: true, title: 'Claude z pamięcią firmy', text: 'Serwer MCP i instrukcja krok po kroku. Claude sam zapyta: „Zaktualizować to w AURORA?”' },
    { icon: <Globe size={22} />, title: 'Import ze strony', text: 'Wklej adres — produkty i fakty pojawią się same i będą sprawdzane raz na dobę.' },
    { icon: <GitCompareArrows size={22} />, title: 'Konflikty źródeł', text: 'W mailu 4 500, w bazie 4 200? Karta „która wersja jest właściwa” — i jedno kliknięcie.' },
    { icon: <History size={22} />, title: 'Machina czasu', text: 'Kto, kiedy i skąd zmienił każdy fakt. Porównanie wersji i cofnięcie jednym przyciskiem.' },
    { icon: <Sunrise size={22} />, title: 'Poranne podsumowanie', text: 'O 7:00 — krótkie podsumowanie zmian z ostatniej doby dla całego zespołu.' },
    { icon: <CircleHelp size={22} />, title: 'Luki w wiedzy', text: 'Lista pytań, na które baza jeszcze nie umie odpowiedzieć.' },
    { icon: <Bell size={22} />, title: 'Właściciele i obserwowanie', text: 'Produkt ma osobę odpowiedzialną, a zespół dostaje powiadomienia o zmianach.' },
    { icon: <Palette size={22} />, wide: true, title: 'Marka w jednym miejscu', text: 'Strategia, tone of voice, kolory, fonty, logotypy i zdjęcia produktów. AI pisze w Twoim tonie, a zespół bierze grafikę tylko stąd.' },
  ]

  const privacy: [ReactNode, string, string][] = [
    [<EyeOff key="1" size={20} />, 'Wiadomości nie są przechowywane', 'AI czyta wiadomość i zapisuje tylko neutralnie opisany fakt o produkcie — bez cytatów, adresów i nazwisk.'],
    [<Lock key="2" size={20} />, 'Prywatne jest odrzucane', 'Życie prywatne, wynagrodzenia, HR, dane klientów, niezakończone negocjacje i hasła nie trafiają do bazy.'],
    [<Mail key="3" size={20} />, 'Tylko odczyt', 'AURORA nie wysyła, nie zmienia i nie usuwa wiadomości. Dostęp wyłącza się jednym przyciskiem.'],
    [<UserRound key="4" size={20} />, 'Każda firma ma własną bazę', 'Dane firm są odizolowane. Czaty widzi tylko ich autor.'],
  ]

  return (
    <div className="lp" ref={root}>
      <header className="lp-nav">
        <Link to="/" className="lp-nav__logo" aria-label="AURORA"><Wordmark size={22} /></Link>
        <nav className="lp-nav__links">
          <a href="#screens">System</a>
          <a href="#how">Jak działa</a>
          <a href="#features">Możliwości</a>
          <a href="#privacy">Prywatność</a>
        </nav>
        <Link to={enter} className="btn btn--primary">{enterLabel}</Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero__head">
          <h1>Wszystko o Twoich produktach w jednym miejscu. <span>Zawsze aktualne.</span></h1>
        </div>
        <div className="lp-hero__cols">
          <div>
            <h3>Baza wiedzy</h3>
            <p>Produkty, ceny, terminy, komunikaty i marka. AURORA czyta pocztę i kalendarz zespołu, stronę i dokumenty — i sama nanosi potwierdzone zmiany.</p>
          </div>
          <div>
            <h3>Czat i Claude</h3>
            <p>Zapytaj na czacie albo prosto w Claude. Odpowiedź zawsze ze źródłem, a prywatna korespondencja nigdy nie trafia do bazy.</p>
          </div>
          <div className="lp-hero__cta">
            <Link to={enter} className="btn btn--accent btn--lg">{enterLabel}<ArrowUpRight size={19} /></Link>
            <a href="#how" className="btn btn--ghost btn--lg">Jak to działa</a>
            <small>Rejestracja na razie na zaproszenie — konto wydaje administrator firmy.</small>
          </div>
        </div>

        <div className="lp-stage" aria-hidden>
          <img className="lp-stage__win lp-stage__win--back" src="/lp/chat.webp" alt="" width={2720} height={1720} />
          <img className="lp-stage__win lp-stage__win--front" src="/lp/kb.webp" alt="" width={2720} height={1720} loading="eager" />
        </div>
      </section>

      <div className="lp-band rv" aria-hidden>
        <Pattern />
        <span>A continuous line. A distinct signature.</span>
      </div>

      <section className="lp-sec" id="screens">
        <div className="lp-sec__head rv">
          <h2>To nie makieta. AURORA już działa.</h2>
        </div>
        <Showcase />
      </section>

      <section className="lp-sec" id="how">
        <div className="lp-sec__head rv">
          <h2>Wiedza zbiera się sama. Ty rozstrzygasz tylko to, co sporne.</h2>
        </div>
        <div className="lp-steps">
          {steps.map(([n, title, text, icons], i) => (
            <article key={n} className="lp-step rv" style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="lp-step__n">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <div className="lp-step__icons">{icons.map((ic, k) => <span key={k}>{ic}</span>)}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-sec" id="features">
        <div className="lp-sec__head rv">
          <h2>Jeden sztab dla produktów, aktualności i marki.</h2>
        </div>
        <div className="lp-bento">
          {features.map((f, i) => (
            <article key={f.title} className={`lp-feat rv${f.wide ? ' lp-feat--wide' : ''}${f.dark ? ' lp-feat--dark' : ''}${f.accent ? ' lp-feat--accent' : ''}`} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
              <span className="lp-feat__ico">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-privacy" id="privacy">
        <div className="lp-privacy__in">
          <div className="lp-sec__head rv">
            <h2>Do bazy trafia tylko to, co może wiedzieć cały zespół.</h2>
          </div>
          <div className="lp-privacy__grid">
            {privacy.map(([icon, title, text], i) => (
              <div key={title} className="lp-priv rv" style={{ transitionDelay: `${i * 70}ms` }}>
                {icon}
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec lp-roles">
        <div className="lp-sec__head rv">
          <h2>Trzy role — i żadnego zamieszania.</h2>
        </div>
        <div className="lp-steps">
          {[
            ['Moderator', 'Tworzy firmy i swobodnie przełącza się między nimi. Wyznacza administratorów.'],
            ['Administrator', 'Dodaje ludzi do swojej firmy, rozstrzyga sporne zmiany, prowadzi markę.'],
            ['Pracownik', 'Czyta bazę, pyta AI, podłącza swoją pocztę i Claude.'],
          ].map(([title, text], i) => (
            <article key={title} className="lp-step rv" style={{ transitionDelay: `${i * 90}ms` }}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-cta rv">
        <AppIcon size={72} />
        <h2>Miejsce, w którym firma wie o sobie wszystko.</h2>
        <Link to={enter} className="btn btn--primary btn--lg">{enterLabel}<ArrowUpRight size={19} /></Link>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot__row">
          <span className="row"><Mark size={18} />AURORA © 2026</span>
          <span className="muted">Aktualna wiedza. Silna marka.</span>
        </div>
        <Wordmark className="lp-foot__big" size={200} />
      </footer>
    </div>
  )
}
