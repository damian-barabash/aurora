import { useEffect, useRef, useState } from 'react'
import { Markdown } from './Markdown'

/** Dopóki odpowiedź płynie, domykamy niedokończone **pogrubienie** i `kod`, żeby znaczniki nie migały. */
function closeOpenMarks(text: string): string {
  let out = text.replace(/\[\d{0,2}$/, '')
  if (((out.match(/\*\*/g) ?? []).length & 1) === 1) out += '**'
  if (((out.match(/`/g) ?? []).length & 1) === 1) out += '`'
  return out
}

/**
 * Tekst odpowiedzi wypisywany płynnie. Model oddaje tokeny porcjami i nierówno, więc nie pokazujemy ich
 * od razu: w każdej klatce odsłaniamy kawałek zaległości — im większa, tym szybciej — a końcówka wygasa łagodnie.
 */
export function StreamText({ text, streaming }: { text: string; streaming: boolean }) {
  const [shown, setShown] = useState(streaming ? 0 : text.length)
  const target = useRef(text)
  const pos = useRef(shown)
  target.current = text

  useEffect(() => {
    if (pos.current >= target.current.length && !streaming) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const backlog = target.current.length - pos.current
      if (backlog > 0) {
        // bazowo ~45 znaków/s, zaległość nadrabiamy w ok. pół sekundy
        const speed = 45 + backlog * 2.2
        pos.current = Math.min(target.current.length, pos.current + (speed * dt) / 1000)
        setShown(Math.floor(pos.current))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [streaming, text.length > 0])

  const done = !streaming && shown >= text.length
  if (done) return <Markdown text={text} />
  // tniemy na granicy słowa, żeby litery nie „doskakiwały” w środku wyrazu
  let cut = shown
  if (cut < text.length) {
    const space = text.lastIndexOf(' ', cut)
    if (space > cut - 14 && space > 0) cut = space
  }
  return (
    <div className="stream">
      <Markdown text={closeOpenMarks(text.slice(0, cut))} />
    </div>
  )
}
