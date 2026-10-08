const LOCALE = 'pl-PL'

export function fmtDate(value: string | null | undefined, withYear = true): string {
  if (!value) return ''
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}

/** „Dziś, 10:24” · „Wczoraj, 16:40” · „6 paź, 14:30” */
export function fmtWhen(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(d)) / 86400000)
  if (diff === 0) return `Dziś, ${time}`
  if (diff === 1) return `Wczoraj, ${time}`
  return `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}, ${time}`
}

/** Formy liczebników: plural(5, ['materiał', 'materiały', 'materiałów']) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (Math.abs(n) === 1) return forms[0]
  if (a > 10 && a < 20) return forms[2]
  if (b >= 2 && b <= 4) return forms[1]
  return forms[2]
}
