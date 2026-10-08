const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const find = (id: string) => document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)

/** Krótkie podświetlenie elementu listy: „zrobione”. */
export async function flash(id: string) {
  const el = find(id)
  if (!el || reduced()) return
  el.classList.add('is-flash')
  await wait(420)
  el.classList.remove('is-flash')
}

/**
 * Element listy znika płynnie: (opcjonalnie) błysk potwierdzenia, potem zwija się i gaśnie.
 * Wołać po udanej akcji, a dopiero potem odświeżać dane — React usunie już niewidoczny węzeł.
 */
export async function leave(id: string, confirm = false) {
  const el = find(id)
  if (!el || reduced()) return
  if (confirm) {
    el.classList.add('is-flash')
    await wait(380)
  }
  const cs = getComputedStyle(el)
  const gap = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).rowGap) || 0 : 0
  el.style.overflow = 'hidden'
  el.style.pointerEvents = 'none'
  await el.animate(
    [
      { height: `${el.offsetHeight}px`, opacity: 1, transform: 'none', marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
      { opacity: 0, transform: 'scale(0.98)', offset: 0.45 },
      { height: '0px', opacity: 0, transform: 'scale(0.98)', marginTop: '0px', marginBottom: `${-gap}px`, paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' },
    ],
    { duration: 460, easing: EASE, fill: 'forwards' },
  ).finished.catch(() => {})
}
