import { useRef, useState, useEffect, useSyncExternalStore } from 'react'
import { refreshUsage } from '../lib/queryClient'
import { Icon } from './ui'
import { Markdown } from './Markdown'
import { apiBase, authHeaders, getRole, getName } from '../lib/auth'

interface Msg { role: 'user' | 'assistant'; content: string; at: number; pending?: boolean }

const SUGGESTIONS: Record<string, string[]> = {
  user: ['How do I scan a claim packet?', 'How does JD1 → JD2 work?', 'How much AI allowance do I have left?'],
  admin: ['How do I scan a claim packet?', 'How do I set up an insurer?', 'Where do I see reports?'],
  super_admin: ['How do I create a demo user?', 'How do I set AI limits?', 'How do I scan a claim packet?'],
}

// Conversation lives outside React so it survives page changes (cleared on sign-out/reload).
let convo: Msg[] = []
let busy = false
const subs = new Set<() => void>()
let snap = { convo, busy }
const emit = () => { snap = { convo, busy }; subs.forEach((f) => f()) }
const setConvo = (next: Msg[]) => { convo = next; emit() }
export function clearChat() { convo = []; busy = false; emit() }

async function ask(text: string) {
  if (busy) return
  const history = [...convo, { role: 'user', content: text, at: Date.now() } as Msg]
  setConvo([...history, { role: 'assistant', content: '', at: Date.now(), pending: true }])
  busy = true; emit()
  const put = (content: string, done: boolean) =>
    setConvo([...history, { role: 'assistant', content, at: Date.now(), pending: !done }])
  try {
    const r = await fetch(`${apiBase()}/api/assistant/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
    })
    if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); put(d.detail || 'Sorry, something went wrong.', true); return }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let last = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'text') { last = ev.text; put(last, false) }
          if (ev.type === 'done') { last = ev.text; put(last, true); refreshUsage() }
        } catch { /* ignore */ }
      }
    }
    if (!last) put('Sorry, I couldn\'t answer just now. Please try again.', true)
  } catch {
    put('Cannot reach the assistant — please check your connection and try again.', true)
  } finally { busy = false; emit() }
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const state = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
  const endRef = useRef<HTMLDivElement>(null)
  const role = getRole()
  const first = (getName() || '').split(' ')[0]

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [state.convo, open])

  function send(text = input) {
    const t = text.trim()
    if (!t || state.busy) return
    setInput('')
    void ask(t)
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} title="Ask the ClaimFlow assistant" aria-label="Open the help assistant"
          className="fixed bottom-5 right-5 z-30 w-12 h-12 rounded-full bg-primary text-white shadow-lg grid place-items-center hover:scale-[1.05] transition-transform">
          <Icon name="chat_bubble" className="text-[22px]" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-30 w-[24rem] h-[36rem] max-h-[calc(100vh-2.5rem)] bg-white border border-outline-variant rounded-2xl shadow-2xl flex flex-col overflow-hidden" role="dialog" aria-label="ClaimFlow assistant">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-br from-primary to-primary-container text-white">
            <div className="w-9 h-9 rounded-full bg-white/15 grid place-items-center"><Icon name="support_agent" className="text-[20px]" /></div>
            <div className="flex-1 leading-tight">
              <div className="font-semibold text-sm">ClaimFlow Assistant</div>
              <div className="text-[11px] text-white/80 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-status-approved inline-block" />Help with using the system</div>
            </div>
            {state.convo.length > 0 && <button onClick={clearChat} title="Start a new conversation" className="text-white/80 hover:text-white"><Icon name="restart_alt" className="text-[20px]" /></button>}
            <button onClick={() => setOpen(false)} title="Close" className="text-white/80 hover:text-white"><Icon name="close" className="text-[20px]" /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-surface/50">
            {state.convo.length === 0 && (
              <div>
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0"><Icon name="support_agent" className="text-[16px]" /></div>
                  <div className="bg-white border border-outline-variant rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-on-surface shadow-sm">
                    Hi{first ? ` ${first}` : ''}! Ask me how to use any part of ClaimFlow — I'll answer in a few short steps.
                  </div>
                </div>
                <div className="mt-3 pl-9 flex flex-col items-start gap-1.5">
                  {(SUGGESTIONS[role] ?? SUGGESTIONS.user).map((s) => (
                    <button key={s} onClick={() => send(s)} className="text-xs text-primary border border-primary/30 bg-white rounded-full px-3 py-1 hover:bg-primary/5">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {state.convo.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex flex-col items-end">
                <div className="max-w-[85%] bg-primary text-white rounded-2xl rounded-tr-sm px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm">{m.content}</div>
                <span className="text-[10px] text-outline mt-1">{time(m.at)}</span>
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0"><Icon name="support_agent" className="text-[16px]" /></div>
                <div className="max-w-[85%]">
                  <div className="bg-white border border-outline-variant rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-on-surface shadow-sm">
                    {m.content ? <Markdown text={m.content} /> : (
                      <span className="inline-flex gap-1 py-1" aria-label="Assistant is typing">
                        {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-outline animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                      </span>
                    )}
                  </div>
                  {!m.pending && <span className="text-[10px] text-outline mt-1 inline-block">{time(m.at)}</span>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="p-3 border-t border-outline-variant bg-white">
            <div className="flex items-end gap-2">
              <textarea value={input} rows={1} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Ask about using the system…" aria-label="Your question"
                className="flex-1 resize-none max-h-28 text-sm border border-outline-variant rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
              <button onClick={() => send()} disabled={state.busy || !input.trim()} title="Send"
                className="w-10 h-10 rounded-xl bg-primary text-white grid place-items-center disabled:opacity-40"><Icon name="send" className="text-[18px]" /></button>
            </div>
            <p className="text-[10px] text-outline mt-1.5 text-center">Enter to send · Shift+Enter for a new line · Not medical, legal or claim-decision advice</p>
          </div>
        </div>
      )}
    </>
  )
}
