// Znaki AURORA przerysowane 1:1 z brand kitu (krzywe z logos/svg i icons/svg).

import type { CSSProperties } from 'react'

const A = 'M42 100 L70 23 C76 7 86 0 99 0 C112 0 122 7 128 23 L184 172 C193 196 178 213 160 209 C153 208 148 204 142 200 L94 166 C72 149 57 155 49 161 C39 169 34 189 28 209 L0 209 L17 165 C30 132 55 126 76 131 C89 133 100 139 113 149 L159 180 L106 31 Q100 19 96 31 L66 109 Z'
const U = 'M13 0 V131 C13 173 39 197 75 197 C111 197 137 173 137 131 V0'
const R = 'M13 210 V13 H77 C119 13 143 33 143 64 C143 96 120 115 86 115 H54 C87 129 113 175 143 203'
const O = 'M88 13 C42 13 13 47 13 105 C13 163 42 197 88 197 C134 197 163 163 163 105 C163 47 134 13 88 13 Z'

interface Props {
  size?: number
  className?: string
  style?: CSSProperties
  title?: string
}

/** Znak «A» — otwarta forma. */
export function Mark({ size = 24, className, style, title = 'AURORA' }: Props) {
  return (
    <svg className={className} style={style} width={(size * 189) / 210} height={size} viewBox="-2 -1 193 212" role="img" aria-label={title}>
      <path d={A} fill="currentColor" />
    </svg>
  )
}

/** Autorski napis AURORA. `size` = wysokość liter. */
export function Wordmark({ size = 22, className, style, title = 'AURORA' }: Props) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 26, strokeLinejoin: 'round' as const }
  return (
    <svg className={className} style={style} height={size} width={(size * 1231) / 212} viewBox="0 -1 1231 212" role="img" aria-label={title}>
      <path d={A} fill="currentColor" />
      <path transform="translate(226)" d={U} {...stroke} />
      <path transform="translate(423)" d={R} {...stroke} />
      <path transform="translate(622)" d={O} {...stroke} />
      <path transform="translate(844)" d={R} {...stroke} />
      <path transform="translate(1041)" d={A} fill="currentColor" />
    </svg>
  )
}

/** Ikona aplikacji: znak na różowym (lub czarnym) polu. */
export function AppIcon({ size = 40, tone = 'accent', className }: { size?: number; tone?: 'accent' | 'black' | 'white'; className?: string }) {
  const bg = tone === 'accent' ? 'var(--accent)' : tone === 'black' ? '#000' : '#fff'
  return (
    <span
      className={className}
      style={{
        width: size, height: size, borderRadius: size * 0.26, background: bg, color: tone === 'black' ? '#fff' : '#000',
        display: 'inline-grid', placeItems: 'center', flex: 'none', border: tone === 'white' ? '1px solid var(--line)' : undefined,
      }}
    >
      <Mark size={size * 0.52} />
    </span>
  )
}

export const BRAND_ICONS = ['spark', 'bloom', 'flow', 'orbit', 'direction', 'dawn'] as const
export type BrandIconName = (typeof BRAND_ICONS)[number]

const ICONS: Record<BrandIconName, { w: number; paths: string[]; extra?: 'orbit' }> = {
  spark: { w: 11, paths: ['M70 8 C70 42 98 70 132 70 C98 70 70 98 70 132 C70 98 42 70 8 70 C42 70 70 42 70 8 Z'] },
  dawn: { w: 11, paths: ['M25 101 C25 74 43 53 70 53 C97 53 115 74 115 101 M8 124 C30 109 51 110 70 123 C90 136 112 137 133 121 M70 9 V29 M16 35 L30 49 M111 49 L125 35'] },
  orbit: { w: 10, paths: [], extra: 'orbit' },
  flow: { w: 11, paths: ['M5 32 C27 7 48 7 70 32 C92 57 113 57 135 32', 'M5 70 C27 45 48 45 70 70 C92 95 113 95 135 70', 'M5 108 C27 83 48 83 70 108 C92 133 113 133 135 108'] },
  direction: { w: 13, paths: ['M19 123 L113 29 M39 23 H104 C116 23 122 29 122 41 V103'] },
  bloom: { w: 10, paths: ['M70 70 C23 70 6 52 19 31 C32 10 56 12 70 70 C70 23 88 6 109 19 C130 32 128 56 70 70 C117 70 134 88 121 109 C108 130 84 128 70 70 C70 117 52 134 31 121 C10 108 12 84 70 70 Z'] },
}

/** Sześć dodatkowych symboli marki — używane jako ikony produktów. */
export function BrandIcon({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const icon = ICONS[(name as BrandIconName) in ICONS ? (name as BrandIconName) : 'spark']
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: icon.w, strokeLinejoin: 'round' as const }
  return (
    <svg className={className} width={size} height={size} viewBox="-6 -6 152 152" aria-hidden>
      {icon.extra === 'orbit' && (
        <>
          <circle cx="70" cy="70" r="48" {...common} />
          <ellipse cx="70" cy="70" rx="76" ry="24" transform="rotate(-35 70 70)" {...common} />
        </>
      )}
      {icon.paths.map((d) => <path key={d} d={d} {...common} />)}
    </svg>
  )
}

/** Wzór z monogramu: rząd przyciętych znaków «A». */
export function Pattern({ className, color = '#fff' }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 1600 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {[-100, 250, 600, 950, 1300].map((x) => <path key={x} transform={`translate(${x} -120) scale(2.5)`} d={A} fill={color} />)}
    </svg>
  )
}
