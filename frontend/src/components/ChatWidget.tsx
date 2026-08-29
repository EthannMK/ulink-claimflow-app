import { useRef, useState, useEffect } from 'react'
import { Icon } from './ui'
import { apiBase, authHeaders } from '../lib/auth'

interface Msg { role: 'user' | 'assistant'; content: string }
const GREETING: Msg = { role: 'assistant', content: "Hi! I'm the ClaimFlow assistant. Ask me how to use any part of the system — uploading a claim packet, the JD1→JD2 flow, setting up insurers, and more." }

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user', content: text } as Msg]
    setMsgs(next); setInput(''); setBusy(true)
    try {
      const r = await fetch(`${apiBase()}/api/assistant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ messages: next.filter((m) => m !== GREETING) }),
      })
      const d = await r.json().catch(() => ({}))
      setMsgs((m) => [...m, { role: 'assistant', content: d.reply || d.detail || 'Sorry, something went wrong.' }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Cannot reach the assistant — is the backend running?' }])
    } finally { setBusy(false) }
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} title="Help assistant"
          className="fixed bottom-5 right-5 z-30 w-14 h-14 rounded-full bg-primary text-white shadow-lg grid place-items-center hover:bg-primary-dark">
          <Icon name="chat" className="text-[24px]" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-30 w-80 h-[28rem] bg-white border border-outline-variant rounded-xl shadow-2xl flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-primary text-white rounded-t-xl">
            <Icon name="smart_toy" className="text-[20px]" />
            <span className="font-semibold text-sm flex-1">ClaimFlow Assistant</span>
            <button onClick={() => setOpen(false)}><Icon name="close" className="text-[20px]" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.map((m, i) => (
              <div key={i} className={`text-sm ${m.role === 'user' ? 'text-right' : ''}`}>
                <span className={`inline-block px-3 py-1.5 rounded-lg ${m.role === 'user' ? 'bg-primary text-white' : 'bg-surface-container text-on-surface'}`}>{m.content}</span>
              </div>
            ))}
            {busy && <div className="text-xs text-outline">Assistant is typing…</div>}
            <div ref={endRef} />
          </div>
          <div className="p-2 border-t border-outline-variant">
            <div className="flex items-center gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }}
                placeholder="Ask about using the system…" className="flex-1 text-sm border border-outline-variant rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
              <button onClick={send} disabled={busy} className="w-9 h-9 rounded-lg bg-primary text-white grid place-items-center disabled:opacity-50"><Icon name="send" className="text-[18px]" /></button>
            </div>
            <p className="text-[10px] text-outline mt-1 text-center">Helps with using the app only — not medical, legal or claim-decision advice.</p>
          </div>
        </div>
      )}
    </>
  )
}
