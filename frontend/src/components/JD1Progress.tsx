import { useEffect, useState } from 'react'
import { jd1Runner, type JD1RunState } from '../lib/jd1Runner'
import { Card, Icon } from './ui'

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * Live view of a JD1 scan. Tabs only change what is displayed — the scan itself runs in
 * jd1Runner (outside React), so switching tabs can never slow down or restart it.
 */
export function JD1Progress({ run }: { run: JD1RunState }) {
  const [tab, setTab] = useState<'progress' | 'log'>('progress')
  const [now, setNow] = useState(Date.now())
  const running = run.status === 'running'
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)   // re-renders this card only
    return () => clearInterval(id)
  }, [running])

  const end = running ? now : run.endedAt || now
  const elapsed = end - run.startedAt
  const quiet = running ? now - run.lastEventAt : 0
  const waitingForAI = running && run.pct >= 15 && run.pct < 30 && run.chars === 0
  const tone = run.status === 'error' ? 'bg-status-rejected' : run.status === 'done' ? 'bg-status-approved' : 'bg-primary'

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <Icon name={running ? 'autorenew' : run.status === 'done' ? 'check_circle' : 'error'}
          className={`text-[20px] ${running ? 'animate-spin text-primary' : run.status === 'done' ? 'text-status-approved' : 'text-status-rejected'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-primary">
            {running ? 'JD1 scan in progress' : run.status === 'done' ? `JD1 scan finished in ${secs(elapsed)}` : 'JD1 scan stopped'}
          </div>
          <div className="text-xs text-outline">
            {run.files.length} file(s) · started {clock(run.startedAt)} · {secs(elapsed)} elapsed
            {run.aiSeconds != null ? ` · AI time ${Math.round(run.aiSeconds)}s` : ''}
          </div>
        </div>
        <div className="flex bg-surface-container rounded-lg p-1" role="tablist">
          {([['progress', 'Progress'], ['log', `Activity log (${run.steps.length})`]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1 rounded-md text-xs font-medium ${tab === k ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>{label}</button>
          ))}
        </div>
        {running
          ? <button onClick={() => jd1Runner.cancel()} className="text-xs text-status-rejected hover:underline">Stop waiting</button>
          : <button onClick={() => jd1Runner.clear()} className="text-xs text-outline hover:underline">Hide</button>}
      </div>

      {tab === 'progress' ? (
        <div>
          <div className="h-2.5 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-valuenow={Math.round(run.pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-all duration-700 ${tone} ${waitingForAI ? 'animate-pulse' : ''}`} style={{ width: `${Math.max(3, run.pct)}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-text-main truncate pr-3">{run.status === 'error' ? run.error : run.current}</span>
            <span className="text-outline shrink-0">{Math.round(run.pct)}%</span>
          </div>
          {waitingForAI && (
            <p className="text-[11px] text-outline mt-1.5">The AI is reading the documents before it starts writing — for scanned packets this is usually the longest step. Waiting {secs(now - (run.steps.find((s) => s.text.startsWith('Sent to'))?.at ?? run.startedAt))}…</p>
          )}
          {running && run.chars > 0 && <p className="text-[11px] text-outline mt-1.5">{run.chars.toLocaleString()} characters of the note written so far</p>}
          {running && quiet > 20000 && <p className="text-[11px] text-status-pending mt-1.5">No news from the server for {secs(quiet)} — still waiting on the AI.</p>}
          {running && <p className="text-[11px] text-outline mt-2">You can switch tabs or open other pages — the scan keeps running and the note appears here when you come back.</p>}
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto border border-outline-variant rounded-lg">
          <table className="w-full text-xs">
            <thead className="text-outline text-left sticky top-0 bg-white"><tr><th className="px-2 py-1 w-20">Time</th><th className="px-2 w-16">Step took</th><th className="px-2">What happened</th></tr></thead>
            <tbody>
              {run.steps.map((s, i) => {
                const next = run.steps[i + 1]?.at ?? (running ? now : run.endedAt)
                const took = next - s.at
                return (
                  <tr key={i} className="border-t border-outline-variant/60 align-top">
                    <td className="px-2 py-1 text-outline whitespace-nowrap">{clock(s.at)}</td>
                    <td className={`px-2 py-1 whitespace-nowrap ${took >= 20000 ? 'text-status-pending font-semibold' : 'text-outline'}`}>{s.kind === 'done' || s.kind === 'error' ? '' : secs(took)}</td>
                    <td className={`px-2 py-1 ${s.kind === 'warn' ? 'text-status-pending' : s.kind === 'error' ? 'text-status-rejected' : s.kind === 'done' ? 'text-status-approved font-medium' : 'text-text-main'}`}>{s.text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
