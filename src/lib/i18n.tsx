import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'ru' | 'pl'

interface I18n {
  lang: Lang
  setLang(l: Lang): void
  /** Tekst w obu językach obok siebie: t('Чаты', 'Czaty') */
  t(ru: string, pl: string): string
}

const Ctx = createContext<I18n>({ lang: 'ru', setLang: () => {}, t: (ru) => ru })

function initial(): Lang {
  const saved = localStorage.getItem('aurora_lang')
  if (saved === 'ru' || saved === 'pl') return saved
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'ru'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('aurora_lang', l)
    setLangState(l)
  }, [])
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (ru, pl) => (lang === 'pl' ? pl : ru) }), [lang, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', pl: 'pl-PL' }

export function fmtDate(value: string | null | undefined, lang: Lang, withYear = true): string {
  if (!value) return ''
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return d.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}

/** «Сегодня, 10:24» · «Вчера, 16:40» · «6 окт., 14:30» */
export function fmtWhen(value: string | null | undefined, lang: Lang): string {
  if (!value) return ''
  const d = new Date(value)
  const time = d.toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(d)) / 86400000)
  if (diff === 0) return `${lang === 'pl' ? 'Dziś' : 'Сегодня'}, ${time}`
  if (diff === 1) return `${lang === 'pl' ? 'Wczoraj' : 'Вчера'}, ${time}`
  return `${d.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short' })}, ${time}`
}

/** Formy liczebników: plural(5, ['материал', 'материала', 'материалов'], lang) */
export function plural(n: number, forms: [string, string, string], lang: Lang = 'ru'): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (lang === 'pl' && Math.abs(n) === 1) return forms[0]
  if (a > 10 && a < 20) return forms[2]
  if (b === 1 && lang === 'ru') return forms[0]
  if (b >= 2 && b <= 4) return forms[1]
  return forms[2]
}
