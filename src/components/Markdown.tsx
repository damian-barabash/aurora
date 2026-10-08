import { Fragment, type ReactNode } from 'react'

/** Небольшой безопасный рендер Markdown: абзацы, списки, заголовки, **жирный**, *курсив*, `код`, ссылки и сноски [1]. */
export function Markdown({ text, onCite }: { text: string; onCite?(n: number): void }) {
  const inline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = []
    const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|\[(\d{1,2})\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g
    let last = 0
    let m: RegExpExecArray | null
    let i = 0
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index))
      const k = `${key}-${i++}`
      if (m[2]) out.push(<strong key={k}>{m[2]}</strong>)
      else if (m[3]) out.push(<em key={k}>{m[3]}</em>)
      else if (m[4]) out.push(<code key={k}>{m[4]}</code>)
      else if (m[5]) out.push(<span key={k} className="cite" onClick={() => onCite?.(Number(m![5]))}>{m[5]}</span>)
      else if (m[6]) out.push(<a key={k} href={m[7]} target="_blank" rel="noreferrer">{m[6]}</a>)
      last = m.index + m[0].length
    }
    if (last < s.length) out.push(s.slice(last))
    return out
  }

  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `p${blocks.length}-${i}`)}</Fragment>)}</p>)
      para = []
    }
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
      list = null
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const head = line.match(/^#{1,4}\s+(.*)$/)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (!line.trim()) flush()
    else if (head) {
      flush()
      blocks.push(<h4 key={blocks.length}>{inline(head[1], `h${blocks.length}`)}</h4>)
    } else if (bullet || num) {
      if (para.length) flush()
      const ordered = !!num
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? num)![1])
    } else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return <div className="md">{blocks}</div>
}
