import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listPrompts, getPrompt, savePrompt, resetPrompt, testPrompt, getAiStatus, type PromptDetail, type PromptTestResult } from '../lib/api'
import { getRole } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'

const fmtDate = (s: string) => (s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')

function pretty(output: string): string {
  const m = output.match(/\{[\s\S]*\}/)
  if (!m) return output
  try { return JSON.stringify(JSON.parse(m[0]), null, 2) } catch { return output }
}

export function AiPromptsPage() {
  const isSuper = getRole() === 'super_admin'
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['prompts'], queryFn: listPrompts, enabled: isSuper })
  const status = useQuery({ queryKey: ['ai-status'], queryFn: getAiStatus, enabled: isSuper })
  const [sel, setSel] = useState<string>('')
  const [detail, setDetail] = useState<PromptDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [view, setView] = useState<'edit' | 'default'>('edit')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // test panel
  const [sample, setSample] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [provider, setProvider] = useState('')
  const [result, setResult] = useState<PromptTestResult | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => { if (!sel && list.data?.length) setSel(list.data[0].id) }, [list.data, sel])
  useEffect(() => {
    if (!sel) return
    setDetail(null); setResult(null); setMsg(''); setView('edit')
    getPrompt(sel).then((d) => { setDetail(d); setDraft(d.text) }).catch((e) => setMsg(String(e?.message ?? e)))
  }, [sel])

  const dirty = !!detail && draft !== detail.text
  const words = useMemo(() => (draft.trim() ? draft.trim().split(/\s+/).length : 0), [draft])
  const isChat = detail?.id === 'help_assistant'

  async function save() {
    if (!detail) return
    setBusy(true); setMsg('')
    try { const d = await savePrompt(detail.id, draft); setDetail(d); setDraft(d.text); setMsg(d.custom ? 'Saved — live from the next AI request.' : 'Same as the default — using the default.'); qc.invalidateQueries({ queryKey: ['prompts'] }) }
    catch (e: any) { setMsg(String(e?.message ?? e)) } finally { setBusy(false) }
  }
  async function reset() {
    if (!detail || !window.confirm('Reset this prompt to the built-in default? Your custom version will be removed.')) return
    setBusy(true); setMsg('')
    try { const d = await resetPrompt(detail.id); setDetail(d); setDraft(d.text); setMsg('Reset to the built-in default.'); qc.invalidateQueries({ queryKey: ['prompts'] }) }
    catch (e: any) { setMsg(String(e?.message ?? e)) } finally { setBusy(false) }
  }
  async function runTest() {
    if (!detail) return
    setTesting(true); setResult(null)
    try { setResult(await testPrompt(detail.id, draft, { sample, file, provider })) }
    catch (e: any) { setResult({ ok: false, output: '', error: String(e?.message ?? e), seconds: 0, json_ok: null, provider_label: '', model: '' }) }
    finally { setTesting(false) }
  }

  if (!isSuper) return <Card className="p-8 text-center text-sm text-text-main">AI prompts are available to Super Admin only.</Card>

  return (
    <div>
      <PageTitle title="AI Prompts" sub="The instructions each AI feature follows. Edit and test a change safely here, then save it — no restart or redeploy needed." />

      <div className="grid grid-cols-12 gap-4">
        {/* 1. choose */}
        <Card className="col-span-3 p-2 self-start">
          <div className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-outline">1 · Choose a prompt</div>
          {(list.data ?? []).map((p) => (
            <button key={p.id} onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes?')) setSel(p.id) }}
              className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 ${sel === p.id ? 'bg-primary/[0.07]' : 'hover:bg-surface-container'}`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm flex-1 ${sel === p.id ? 'font-semibold text-primary' : 'text-text-main'}`}>{p.name}</span>
                {p.custom ? <Badge className="bg-brand-accent/10 text-brand-accent">Custom</Badge> : <Badge className="bg-surface-container text-outline">Default</Badge>}
              </div>
              <div className="text-[11px] text-outline mt-0.5">Used by: {p.feature}</div>
            </button>
          ))}
        </Card>

        {/* 2. edit */}
        <div className="col-span-5">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-outline">2 · Edit</div>
              {detail && (
                <div className="flex bg-surface-container rounded-lg p-0.5 text-xs">
                  {(['edit', 'default'] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-md ${view === v ? 'bg-white text-primary shadow-sm font-medium' : 'text-text-main'}`}>{v === 'edit' ? 'Current' : 'Built-in default'}</button>
                  ))}
                </div>
              )}
            </div>
            {!detail ? <p className="text-sm text-outline py-10 text-center">{msg || 'Loading…'}</p> : (<>
              <div className="font-semibold text-primary">{detail.name}</div>
              <p className="text-xs text-text-main mt-0.5">{detail.description}</p>
              <div className="flex gap-2 bg-status-pending/10 text-text-main rounded-lg px-3 py-2 mt-2 text-xs">
                <Icon name="info" className="text-status-pending text-[16px] shrink-0" /><span>{detail.note}</span>
              </div>
              <textarea value={view === 'edit' ? draft : detail.default} readOnly={view === 'default'} spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                className="mt-3 w-full h-[28rem] font-mono text-[12px] leading-relaxed rounded-lg p-3 bg-[#0f172a] text-slate-100 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-outline">{words.toLocaleString()} words · {draft.length.toLocaleString()} characters{detail.custom && detail.updated_at ? ` · last changed ${fmtDate(detail.updated_at)} by ${detail.updated_by}` : ''}</span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" onClick={save} disabled={!dirty || busy}><Icon name="save" className="text-[16px]" />Save</Button>
                <Button size="sm" variant="outline" onClick={() => setDraft(detail.text)} disabled={!dirty}>Undo changes</Button>
                <Button size="sm" variant="ghost" onClick={reset} disabled={!detail.custom || busy}><Icon name="restart_alt" className="text-[16px]" />Reset to default</Button>
                {dirty && <span className="text-xs text-status-pending ml-auto">Unsaved — test it first →</span>}
              </div>
              {msg && <p className={`text-xs mt-2 ${/^(Saved|Reset|Same)/.test(msg) ? 'text-status-approved' : 'text-status-rejected'}`}>{msg}</p>}
            </>)}
          </Card>
        </div>

        {/* 3. test */}
        <div className="col-span-4">
          <Card className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-outline mb-2">3 · Test the text on the left (not saved)</div>
            {isChat ? (
              <label className="block text-xs text-text-main">A question a user might ask
                <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="How do I scan a claim packet?" className="mt-1 w-full text-sm border border-outline-variant rounded-md px-2.5 py-1.5" /></label>
            ) : (<>
              <label className="block text-xs text-text-main">Sample document (PDF or image — first 3 pages are used)
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs" /></label>
              <div className="text-[11px] text-outline my-2 text-center">— or paste document text —</div>
              <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={4} placeholder="Paste text from a claim form, invoice or policy…"
                className="w-full text-xs border border-outline-variant rounded-md px-2.5 py-1.5" />
            </>)}
            <label className="block text-xs text-text-main mt-2">Run on
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full text-sm border border-outline-variant rounded-md px-2 py-1.5">
                <option value="">Primary provider (as live)</option>
                {(status.data?.providers ?? []).map((p) => <option key={p.provider} value={p.provider}>{p.label} · {p.model}</option>)}
              </select></label>
            <Button size="sm" className="mt-3 w-full" onClick={runTest} disabled={testing || !detail}>
              <Icon name={testing ? 'autorenew' : 'play_arrow'} className={`text-[16px] ${testing ? 'animate-spin' : ''}`} />{testing ? 'Running…' : 'Run test'}
            </Button>
            <p className="text-[11px] text-outline mt-1.5">Uses real AI and is counted in AI Usage as "Prompt test".</p>
          </Card>

          {result && (
            <Card className="p-4 mt-3">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {result.ok ? <Badge className="bg-status-approved/10 text-status-approved">Answered</Badge> : <Badge className="bg-status-rejected/10 text-status-rejected">Failed</Badge>}
                {result.json_ok === true && <Badge className="bg-status-approved/10 text-status-approved">Valid JSON ✓</Badge>}
                {result.json_ok === false && <Badge className="bg-status-rejected/10 text-status-rejected">Not valid JSON — the app couldn't read this</Badge>}
                <span className="text-[11px] text-outline ml-auto">{result.seconds}s{result.tokens_out != null ? ` · ${result.tokens_in?.toLocaleString()} in / ${result.tokens_out.toLocaleString()} out` : ''}</span>
              </div>
              {result.provider_label && <div className="text-[11px] text-outline mb-2">{result.provider_label} · {result.model}</div>}
              {result.error && <p className="text-xs text-status-rejected mb-2">{result.error}</p>}
              {result.output && <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed bg-[#0f172a] text-slate-100 rounded-lg p-3">{pretty(result.output)}</pre>}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
