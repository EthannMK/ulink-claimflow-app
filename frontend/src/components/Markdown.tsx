import { Fragment, type ReactNode } from 'react'

/**
 * Tiny, safe Markdown renderer for chat replies: paragraphs, **bold**, *italic*, `code`,
 * bullet (-, *, •) and numbered (1.) lists, and "### headings" rendered as bold lines.
 * It builds React elements (never raw HTML), so AI output can't inject markup.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={`${keyBase}-${i++}`} className="px-1 rounded bg-black/5 text-[0.85em]">{tok.slice(1, -1)}</code>)
    else out.push(<em key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) { blocks.push(<p key={`p${blocks.length}`} className="leading-relaxed">{inline(para.join(' '), `p${blocks.length}`)}</p>); para = [] }
  }
  const flushList = () => {
    if (!list) return
    const L = list; const k = `l${blocks.length}`
    blocks.push(L.ordered
      ? <ol key={k} className="list-decimal pl-5 space-y-1">{L.items.map((it, j) => <li key={j} className="leading-relaxed">{inline(it, `${k}-${j}`)}</li>)}</ol>
      : <ul key={k} className="list-disc pl-5 space-y-1">{L.items.map((it, j) => <li key={j} className="leading-relaxed">{inline(it, `${k}-${j}`)}</li>)}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const head = line.match(/^\s*#{1,6}\s+(.*)$/)
    if (bullet || num) {
      flushPara()
      const ordered = !!num
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((bullet ?? num)![1])
    } else if (head) {
      flushPara(); flushList()
      blocks.push(<p key={`h${blocks.length}`} className="font-semibold">{inline(head[1], `h${blocks.length}`)}</p>)
    } else if (!line.trim()) {
      flushPara(); flushList()
    } else {
      if (list) flushList()
      para.push(line.trim())
    }
  }
  flushPara(); flushList()
  return <div className="space-y-2">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
