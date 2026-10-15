// Ilustracje do okna „Co nowego”: każda wersja ma własny znak, który obrazowo pokazuje, co się zmieniło.
// Zasady identyfikacji: czerń, biel i #FDADA4, tylko pełne wypełnienia — bez cieni, gradientów i szumu.

import type { ReactElement } from 'react'

const INK = '#000'
const ACCENT = '#FDADA4'
const PAPER = '#fff'

/** 0.2.0 — holding rozgałęzia się na marki, a marki na produkty. */
function Brands({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <rect x="0" y="0" width="120" height="120" rx="30" fill={ACCENT} />
      {/* gałęzie */}
      <path d="M60 38 V52 M30 52 H90 M30 52 V62 M60 52 V62 M90 52 V62" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* grupa */}
      <rect x="44" y="16" width="32" height="24" rx="8" fill={INK} />
      <rect x="54" y="25" width="12" height="6" rx="3" fill={ACCENT} />
      {/* marki */}
      <rect x="18" y="62" width="24" height="20" rx="7" fill={INK} />
      <rect x="48" y="62" width="24" height="20" rx="7" fill={PAPER} stroke={INK} strokeWidth="4" />
      <rect x="78" y="62" width="24" height="20" rx="7" fill={INK} />
      {/* produkty */}
      <path d="M30 82 V90 M60 82 V90 M90 82 V90" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <circle cx="24" cy="98" r="5" fill={INK} /><circle cx="36" cy="98" r="5" fill={INK} />
      <circle cx="60" cy="98" r="5" fill={INK} />
      <circle cx="84" cy="98" r="5" fill={INK} /><circle cx="96" cy="98" r="5" fill={INK} />
    </svg>
  )
}

/** 0.3.0 — marki-klocki układane na półkach kategorii; jeden klocek właśnie przenoszony na inną półkę. */
function Categories({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <rect x="0" y="0" width="120" height="120" rx="30" fill={INK} />
      {/* półki */}
      <rect x="16" y="50" width="88" height="5" rx="2.5" fill={PAPER} />
      <rect x="16" y="92" width="88" height="5" rx="2.5" fill={PAPER} />
      {/* marki na półkach */}
      <rect x="20" y="30" width="18" height="20" rx="5" fill={PAPER} />
      <rect x="42" y="30" width="18" height="20" rx="5" fill={ACCENT} />
      <rect x="20" y="72" width="18" height="20" rx="5" fill={ACCENT} />
      <rect x="42" y="72" width="18" height="20" rx="5" fill={PAPER} />
      <rect x="64" y="72" width="18" height="20" rx="5" fill={PAPER} />
      {/* przenoszona marka i jej droga */}
      <path d="M73 46 C 92 46, 96 58, 92 66" stroke={ACCENT} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M86 62 L92 69 L97 61" stroke={ACCENT} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="64" y="26" width="18" height="20" rx="5" fill={ACCENT} transform="rotate(-10 73 36)" />
    </svg>
  )
}

/** 0.4.0 — dokument, z którego AI wyjmuje fakty: kartki wylatują z pliku i łączą się w mapę. */
function Reading({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <rect x="0" y="0" width="120" height="120" rx="30" fill={ACCENT} />
      {/* dokument z zagiętym rogiem */}
      <path d="M22 26 h30 l12 12 v50 a6 6 0 0 1 -6 6 h-36 a6 6 0 0 1 -6 -6 v-56 a6 6 0 0 1 6 -6 z" fill={PAPER} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M52 26 v12 h12" fill="none" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M28 52 h26 M28 62 h26 M28 72 h18" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      {/* fakty wyjęte z pliku i połączone */}
      <path d="M66 58 L84 40 M66 58 L92 62 M84 40 L92 62 M92 62 L86 86" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="84" cy="40" r="7" fill={INK} />
      <circle cx="92" cy="62" r="7" fill={INK} />
      <circle cx="86" cy="86" r="6" fill={PAPER} stroke={INK} strokeWidth="3.5" />
      <circle cx="66" cy="58" r="5" fill={INK} />
    </svg>
  )
}

/** 0.4.1 — kalendarz, w którym terminy się sumują: kolejne dni zaznaczone obok siebie i plus dla następnego. */
function Dates({ size }: { size: number }) {
  const cols = [28, 46, 64, 82]
  const rows = [54, 70, 86]
  const marked = new Set(['46,54', '82,54', '28,70', '64,70', '46,86'])
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <rect x="0" y="0" width="120" height="120" rx="30" fill={INK} />
      {/* kartka kalendarza */}
      <rect x="18" y="26" width="84" height="76" rx="10" fill={PAPER} />
      <path d="M18 36 a10 10 0 0 1 10 -10 h64 a10 10 0 0 1 10 10 v8 h-84 z" fill={ACCENT} />
      <rect x="36" y="16" width="7" height="16" rx="3.5" fill={PAPER} />
      <rect x="77" y="16" width="7" height="16" rx="3.5" fill={PAPER} />
      {/* dni: zaznaczone terminy stoją obok siebie, żaden nie wypiera innego */}
      {rows.flatMap((y) => cols.map((x) => marked.has(`${x},${y}`)
        ? <rect key={`${x},${y}`} x={x} y={y} width="12" height="10" rx="3" fill={INK} />
        : <circle key={`${x},${y}`} cx={x + 6} cy={y + 5} r="2.5" fill={INK} />))}
      {/* kolejny termin dopisany */}
      <circle cx="90" cy="92" r="17" fill={ACCENT} stroke={INK} strokeWidth="4" />
      <path d="M90 84 V100 M82 92 H98" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
}

export const RELEASE_ICONS: Record<string, (p: { size: number }) => ReactElement> = {
  brands: Brands,
  categories: Categories,
  reading: Reading,
  dates: Dates,
}

export function ReleaseIcon({ name, size = 96 }: { name: string; size?: number }) {
  const Icon = RELEASE_ICONS[name]
  return Icon ? <Icon size={size} /> : null
}
