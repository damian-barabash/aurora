import {
  ArrowRight, ArrowUpRight, Bell, Bot, Calendar, CircleCheck, CircleHelp, EyeOff, FileText, GitCompareArrows, Globe, History, Lock, Mail,
  MessageSquare, Palette, ShieldCheck, Sunrise, UserRound,
} from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../app/session'
import { AppIcon, BrandIcon, Mark, Pattern, Wordmark } from '../brand/Logo'
import { useI18n, useT } from '../lib/i18n'
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

export default function Landing() {
  const t = useT()
  const { lang, setLang } = useI18n()
  const { session } = useSession()
  const root = useReveal()
  const enter = session ? '/app' : '/login'
  const enterLabel = session ? t('Открыть панель', 'Otwórz panel') : t('Войти', 'Zaloguj się')

  useEffect(() => {
    document.title = t('AURORA — база знаний фирмы, которая обновляется сама', 'AURORA — baza wiedzy firmy, która aktualizuje się sama')
  }, [t])

  const steps: [string, string, string, ReactNode[]][] = [
    ['01', t('Собирает', 'Zbiera'), t('Почта и календарь сотрудников, сайт фирмы, документы и разговоры с Claude. Каждый подключает свои источники одним кликом.', 'Poczta i kalendarz pracowników, strona firmy, dokumenty i rozmowy z Claude. Każdy podłącza swoje źródła jednym kliknięciem.'),
      [<Mail key="m" size={18} />, <Calendar key="c" size={18} />, <Globe key="g" size={18} />, <FileText key="f" size={18} />, <Bot key="b" size={18} />]],
    ['02', t('Проверяет', 'Sprawdza'), t('ИИ отделяет факты о продуктах от личного. Подтверждённое изменение сразу попадает в базу, спорное — ждёт решения человека.', 'AI oddziela fakty o produktach od prywatnych spraw. Potwierdzona zmiana trafia od razu do bazy, sporna — czeka na decyzję człowieka.'),
      [<ShieldCheck key="s" size={18} />, <GitCompareArrows key="g" size={18} />, <EyeOff key="e" size={18} />]],
    ['03', t('Отвечает', 'Odpowiada'), t('Спросите в чате или прямо в Claude — получите ответ с источниками. А утром придёт сводка того, что изменилось.', 'Zapytaj na czacie albo prosto w Claude — dostaniesz odpowiedź ze źródłami. A rano przyjdzie podsumowanie tego, co się zmieniło.'),
      [<MessageSquare key="m" size={18} />, <Bot key="b" size={18} />, <Sunrise key="s" size={18} />]],
  ]

  const features: { icon: ReactNode; title: string; text: string; wide?: boolean; dark?: boolean; accent?: boolean }[] = [
    { icon: <MessageSquare size={22} />, wide: true, title: t('Чат, который не выдумывает', 'Czat, który nie zmyśla'), text: t('Ответы только по базе знаний фирмы, с номерами источников. Если ответа нет — AURORA так и скажет и запишет вопрос в «Пробелы».', 'Odpowiedzi tylko na podstawie bazy wiedzy firmy, z numerami źródeł. Jeśli odpowiedzi nie ma — AURORA to powie i zapisze pytanie w „Lukach”.') },
    { icon: <Mail size={22} />, accent: true, title: t('Почта в один клик', 'Poczta jednym kliknięciem'), text: t('Новая цена в письме шефа — и карточка продукта уже обновлена.', 'Nowa cena w mailu szefa — i karta produktu jest już zaktualizowana.') },
    { icon: <Bot size={22} />, dark: true, title: t('Claude с памятью фирмы', 'Claude z pamięcią firmy'), text: t('MCP-сервер и пошаговая инструкция. Claude сам спросит: «Обновить это в AURORA?»', 'Serwer MCP i instrukcja krok po kroku. Claude sam zapyta: „Zaktualizować to w AURORA?”') },
    { icon: <Globe size={22} />, title: t('Импорт с сайта', 'Import ze strony'), text: t('Вставьте адрес — продукты и факты появятся сами и будут перепроверяться раз в сутки.', 'Wklej adres — produkty i fakty pojawią się same i będą sprawdzane raz na dobę.') },
    { icon: <GitCompareArrows size={22} />, title: t('Конфликты источников', 'Konflikty źródeł'), text: t('В письме 4 500, в базе 4 200? Карточка «какая версия верна» — и одно нажатие.', 'W mailu 4 500, w bazie 4 200? Karta „która wersja jest właściwa” — i jedno kliknięcie.') },
    { icon: <History size={22} />, title: t('Машина времени', 'Machina czasu'), text: t('Кто, когда и откуда изменил каждый факт. Сравнение версий и откат одной кнопкой.', 'Kto, kiedy i skąd zmienił każdy fakt. Porównanie wersji i cofnięcie jednym przyciskiem.') },
    { icon: <Sunrise size={22} />, title: t('Утренний дайджест', 'Poranne podsumowanie'), text: t('В 7:00 — короткая сводка изменений за сутки для всей команды.', 'O 7:00 — krótkie podsumowanie zmian z ostatniej doby dla całego zespołu.') },
    { icon: <CircleHelp size={22} />, title: t('Пробелы в знаниях', 'Luki w wiedzy'), text: t('Список вопросов, на которые база ещё не умеет отвечать.', 'Lista pytań, na które baza jeszcze nie umie odpowiedzieć.') },
    { icon: <Bell size={22} />, title: t('Владельцы и подписки', 'Właściciele i obserwowanie'), text: t('У продукта есть ответственный, а команда получает уведомления об изменениях.', 'Produkt ma osobę odpowiedzialną, a zespół dostaje powiadomienia o zmianach.') },
    { icon: <Palette size={22} />, wide: true, title: t('Бренд в одном месте', 'Marka w jednym miejscu'), text: t('Стратегия, tone of voice, цвета, шрифты, логотипы и фото продуктов. ИИ пишет в вашем тоне, команда берёт графику только отсюда.', 'Strategia, tone of voice, kolory, fonty, logotypy i zdjęcia produktów. AI pisze w Twoim tonie, a zespół bierze grafikę tylko stąd.') },
  ]

  const privacy: [ReactNode, string, string][] = [
    [<EyeOff key="1" size={20} />, t('Письма не хранятся', 'Wiadomości nie są przechowywane'), t('ИИ читает письмо и сохраняет только нейтрально пересказанный факт о продукте — без цитат, адресов и имён.', 'AI czyta wiadomość i zapisuje tylko neutralnie opisany fakt o produkcie — bez cytatów, adresów i nazwisk.')],
    [<Lock key="2" size={20} />, t('Личное отбрасывается', 'Prywatne jest odrzucane'), t('Частная жизнь, зарплаты, HR, данные клиентов, незавершённые переговоры и пароли в базу не попадают.', 'Życie prywatne, wynagrodzenia, HR, dane klientów, niezakończone negocjacje i hasła nie trafiają do bazy.')],
    [<Mail key="3" size={20} />, t('Только чтение', 'Tylko odczyt'), t('AURORA не отправляет, не меняет и не удаляет письма. Доступ отключается одной кнопкой.', 'AURORA nie wysyła, nie zmienia i nie usuwa wiadomości. Dostęp wyłącza się jednym przyciskiem.')],
    [<UserRound key="4" size={20} />, t('У каждой фирмы своя база', 'Każda firma ma własną bazę'), t('Данные фирм изолированы. Чаты видит только их автор.', 'Dane firm są odizolowane. Czaty widzi tylko ich autor.')],
  ]

  return (
    <div className="lp" ref={root}>
      <header className="lp-nav">
        <Link to="/" className="lp-nav__logo" aria-label="AURORA"><Wordmark size={22} /></Link>
        <nav className="lp-nav__links">
          <a href="#how">{t('Как работает', 'Jak działa')}</a>
          <a href="#features">{t('Возможности', 'Możliwości')}</a>
          <a href="#privacy">{t('Приватность', 'Prywatność')}</a>
        </nav>
        <button type="button" className="lp-nav__lang" onClick={() => setLang(lang === 'ru' ? 'pl' : 'ru')}>{lang === 'ru' ? 'PL' : 'RU'}</button>
        <Link to={enter} className="btn btn--primary">{enterLabel}</Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero__text">
          <div className="eyebrow lp-hero__eyebrow"><i />{t('Штаб знаний вашей фирмы', 'Sztab wiedzy Twojej firmy')}</div>
          <h1>{t('Всё о ваших продуктах.', 'Wszystko o Twoich produktach.')}<br />{t('В одном месте.', 'W jednym miejscu.')}<br /><span>{t('Всегда актуально.', 'Zawsze aktualne.')}</span></h1>
          <p>{t('AURORA читает почту и календарь команды, сайт и документы, находит подтверждённые изменения и сама обновляет базу знаний. Спросите в чате или в Claude — ответ будет с источником.', 'AURORA czyta pocztę i kalendarz zespołu, stronę i dokumenty, znajduje potwierdzone zmiany i sama aktualizuje bazę wiedzy. Zapytaj na czacie lub w Claude — odpowiedź będzie ze źródłem.')}</p>
          <div className="lp-hero__cta">
            <Link to={enter} className="btn btn--accent btn--lg">{enterLabel}<ArrowUpRight size={19} /></Link>
            <a href="#how" className="btn btn--ghost btn--lg">{t('Как это работает', 'Jak to działa')}</a>
          </div>
          <small className="lp-hero__note">{t('Регистрация пока по приглашению — аккаунт выдаёт администратор фирмы.', 'Rejestracja na razie na zaproszenie — konto wydaje administrator firmy.')}</small>
        </div>

        <div className="lp-mock" aria-hidden>
          <div className="lp-mock__win">
            <div className="lp-mock__bar"><Wordmark size={11} /><span /><i>{t('База знаний', 'Baza wiedzy')}</i></div>
            <div className="lp-mock__grid">
              {[
                ['spark', 'Track Day Andalusia', t('Сегодня, 10:24', 'Dziś, 10:24'), true],
                ['flow', 'Winter Academy', t('Вчера, 16:40', 'Wczoraj, 16:40'), false],
                ['orbit', 'Corporate Events', '6 ' + t('окт.', 'paź'), false],
                ['bloom', 'Coaching 1:1', '3 ' + t('окт.', 'paź'), false],
              ].map(([icon, name, when, hot]) => (
                <div key={name as string} className="lp-mock__card">
                  <span className={hot ? 'is-accent' : ''}><BrandIcon name={icon as string} size={18} /></span>
                  <b>{name}</b>
                  <small>{when}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="lp-mock__mail">
            <span className="lp-mock__chip"><Mail size={13} />Gmail</span>
            <p>{t('«Подтверждаю: с 1 ноября цена 4 800 EUR»', '„Potwierdzam: od 1 listopada cena 4 800 EUR”')}</p>
            <div className="lp-mock__arrow"><ArrowRight size={14} /><CircleCheck size={14} />{t('Цена обновлена в базе', 'Cena zaktualizowana w bazie')}</div>
          </div>
          <div className="lp-mock__chat">
            <div className="lp-mock__q">{t('Сколько стоит Track Day в ноябре?', 'Ile kosztuje Track Day w listopadzie?')}</div>
            <div className="lp-mock__a">
              <AppIcon size={26} />
              <p><b>4 800 EUR</b> {t('с 1 ноября', 'od 1 listopada')} <i>1</i><br />{t('Даты: 16–17 ноября', 'Terminy: 16–17 listopada')} <i>2</i></p>
            </div>
          </div>
        </div>
      </section>

      <div className="lp-band rv" aria-hidden>
        <Pattern />
        <span>A continuous line. A distinct signature.</span>
      </div>

      <section className="lp-sec" id="how">
        <div className="lp-sec__head rv">
          <div className="eyebrow">{t('Как это работает', 'Jak to działa')}</div>
          <h2>{t('Знания собираются сами. Вы только решаете спорное.', 'Wiedza zbiera się sama. Ty rozstrzygasz tylko to, co sporne.')}</h2>
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
          <div className="eyebrow">{t('Возможности', 'Możliwości')}</div>
          <h2>{t('Один штаб для продуктов, новостей и бренда.', 'Jeden sztab dla produktów, aktualności i marki.')}</h2>
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
            <div className="eyebrow">{t('Приватность', 'Prywatność')}</div>
            <h2>{t('В базу попадает только то, что можно знать всей команде.', 'Do bazy trafia tylko to, co może wiedzieć cały zespół.')}</h2>
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
          <div className="eyebrow">{t('Доступ', 'Dostęp')}</div>
          <h2>{t('Три роли — и никакой путаницы.', 'Trzy role — i żadnego zamieszania.')}</h2>
        </div>
        <div className="lp-steps">
          {[
            [t('Модератор', 'Moderator'), t('Создаёт фирмы и свободно переключается между ними. Назначает администраторов.', 'Tworzy firmy i swobodnie przełącza się między nimi. Wyznacza administratorów.')],
            [t('Администратор', 'Administrator'), t('Добавляет людей в свою фирму, решает спорные изменения, ведёт бренд.', 'Dodaje ludzi do swojej firmy, rozstrzyga sporne zmiany, prowadzi markę.')],
            [t('Сотрудник', 'Pracownik'), t('Читает базу, спрашивает ИИ, подключает свою почту и Claude.', 'Czyta bazę, pyta AI, podłącza swoją pocztę i Claude.')],
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
        <h2>{t('Место, где фирма знает всё о себе.', 'Miejsce, w którym firma wie o sobie wszystko.')}</h2>
        <Link to={enter} className="btn btn--primary btn--lg">{enterLabel}<ArrowUpRight size={19} /></Link>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot__row">
          <span className="row"><Mark size={18} />AURORA © 2026</span>
          <span className="muted">{t('Актуальные знания. Сильный бренд.', 'Aktualna wiedza. Silna marka.')}</span>
        </div>
        <Wordmark className="lp-foot__big" size={200} />
      </footer>
    </div>
  )
}
