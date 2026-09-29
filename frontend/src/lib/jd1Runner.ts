/**
 * JD1 scan runner — lives OUTSIDE React on purpose.
 *
 * The scan is started here and keeps running no matter what the page does: switching
 * the Progress / Activity-log tabs, re-rendering, or even navigating to another page
 * of the app doesn't touch it (only a full browser reload would). The JD1 page just
 * subscribes to its state, and picks up the finished note when it's (back) on screen.
 */
import { useSyncExternalStore } from 'react'
import { apiBase, authHeaders } from './auth'
import type { JD1Note } from './jd1'

export interface RunStep { at: number; text: string; kind: 'step' | 'warn' | 'error' | 'done'; pct?: number | null }
export interface JD1RunState {
  status: 'idle' | 'running' | 'done' | 'error'
  startedAt: number; endedAt: number
  files: File[]
  pct: number            // 0-100, only ever moves forward
  current: string        // latest step text
  chars: number          // characters of the AI's answer received so far
  lastEventAt: number
  aiSeconds: number | null
  steps: RunStep[]
  note: JD1Note | null
  error: string
  consumed: boolean      // the JD1 page has applied the result
}

const IDLE: JD1RunState = {
  status: 'idle', startedAt: 0, endedAt: 0, files: [], pct: 0, current: '', chars: 0, lastEventAt: 0,
  aiSeconds: null, steps: [], note: null, error: '', consumed: true,
}
let state: JD1RunState = IDLE
let controller: AbortController | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<JD1RunState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
function addStep(step: Omit<RunStep, 'at'>) {
  const s: RunStep = { at: Date.now(), ...step }
  set({
    steps: [...state.steps, s],
    current: step.text || state.current,
    pct: step.pct != null ? Math.max(state.pct, step.pct) : state.pct,
    lastEventAt: s.at,
  })
}

function handle(ev: any) {
  switch (ev.type) {
    case 'start': addStep({ kind: 'step', text: `Scan started — uploading done, ${(ev.files ?? []).length} file(s) on the server`, pct: 1 }); break
    case 'step': case 'warn':
      if (ev.text) addStep({ kind: ev.type, text: ev.text, pct: ev.pct })
      if (ev.ai_seconds != null) set({ aiSeconds: ev.ai_seconds })
      break
    case 'stream': set({ chars: ev.chars ?? state.chars, lastEventAt: Date.now() }); break
    case 'ping': set({ lastEventAt: Date.now() }); break
    case 'result':
      set({ note: ev.note as JD1Note })
      addStep({ kind: 'done', text: 'Done — the JD1 note is on the page', pct: 100 })
      set({ status: 'done', endedAt: Date.now(), consumed: false })
      break
    case 'error':
      addStep({ kind: 'error', text: ev.detail || 'The scan failed' })
      set({ status: 'error', error: ev.detail || 'The scan failed', endedAt: Date.now(), consumed: false })
      break
  }
}

async function run(files: File[], signal: AbortSignal) {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f, f.name))
  try {
    const r = await fetch(`${apiBase()}/api/jd1/stream`, { method: 'POST', headers: authHeaders(), body: fd, signal })
    if (!r.ok || !r.body) {
      const d = await r.json().catch(() => ({}))
      handle({ type: 'error', detail: d.detail || `JD1 failed (${r.status})` }); return
    }
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (line) { try { handle(JSON.parse(line)) } catch { /* ignore a malformed line */ } }
      }
    }
    if (state.status === 'running') handle({ type: 'error', detail: 'The connection closed before the scan finished. Please try again.' })
  } catch (e: any) {
    if (e?.name === 'AbortError') return
    handle({ type: 'error', detail: 'Lost connection to the server: ' + (e?.message ?? 'unknown') })
  }
}

export const jd1Runner = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
  /** Start a scan (ignored while one is already running). */
  start(files: File[]) {
    if (state.status === 'running' || !files.length) return
    controller = new AbortController()
    state = { ...IDLE, status: 'running', startedAt: Date.now(), lastEventAt: Date.now(), files, consumed: false, current: 'Uploading files…' }
    listeners.forEach((l) => l())
    void run(files, controller.signal)
  },
  /** Stop waiting (the server may still finish the AI call; its usage is still recorded). */
  cancel() {
    if (state.status !== 'running') return
    controller?.abort()
    addStep({ kind: 'error', text: 'You stopped waiting for this scan' })
    set({ status: 'error', error: 'Stopped by you', endedAt: Date.now(), consumed: true })
  },
  consume() { if (!state.consumed) set({ consumed: true }) },
  /** Hide a finished run's panel. */
  clear() { if (state.status !== 'running') { state = IDLE; listeners.forEach((l) => l()) } },
}

export function useJD1Run(): JD1RunState {
  return useSyncExternalStore(jd1Runner.subscribe, jd1Runner.get)
}
