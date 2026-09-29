import { useEffect, useState } from 'react'
import { getAiStatus, updateAiSettings, type AiProviderStatus, type AiStatus } from '../lib/api'
import { getRole } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'
import { ModelPicker } from '../components/ModelPicker'


export function AiProvidersPage() {
  const isSuper = getRole() === 'super_admin'
  const [rows, setRows] = useState<AiProviderStatus[]>([])
  const [keys, setKeys] = useState<AiStatus['keys']>([])
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    getAiStatus()
      .then((s) => { setRows([...s.providers].sort((a, b) => a.priority - b.priority)); setKeys(s.keys ?? []); setDirty(false) })
      .catch((e) => setMsg(String(e?.message ?? e)))
  }
  useEffect(() => { if (isSuper) load() }, [isSuper])

  function patch(i: number, change: Partial<AiProviderStatus>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r))); setDirty(true); setMsg('')
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows];[next[i], next[j]] = [next[j], next[i]]
    setRows(next.map((r, k) => ({ ...r, priority: k + 1 }))); setDirty(true)
  }
  function useStandardModel() {
    setRows((rs) => rs.map((r) => ({ ...r, model: r.standard_model || r.model }))); setDirty(true)
  }
  async function save() {
    if (!rows.some((r) => r.enabled)) { setMsg('Keep at least one provider switched on, otherwise no AI feature will work.'); return }
    setBusy(true); setMsg('')
    try {
      await updateAiSettings(rows.map(({ provider, model, enabled, priority }) => ({ provider, model: model.trim(), enabled, priority })))
      setMsg('Saved. New AI requests use these settings straight away — no restart needed.'); load()
    } catch (e: any) { setMsg(String(e?.message ?? e)) } finally { setBusy(false) }
  }

  if (!isSuper) return <Card className="p-8 text-center text-sm text-text-main">AI provider settings are available to Super Admin only.</Card>

  return (
    <div>
      <PageTitle title="AI Providers & Models" sub="Choose which AI services the app uses, in what order, and which model each one runs."
        action={<div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={useStandardModel}><Icon name="auto_fix_high" className="text-[16px]" />Use standard model on all</Button>
          <Button size="sm" onClick={save} disabled={!dirty || busy}><Icon name="save" className="text-[16px]" />{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>} />

      <Card className="p-4 mb-4 grid grid-cols-2 gap-4 text-sm">
        <div className="flex gap-3">
          <Icon name="cloud" className="text-primary text-[22px]" />
          <div><div className="font-semibold text-primary">Provider</div>
            <p className="text-text-main text-xs mt-0.5">The company or platform we send the request to — like choosing a phone carrier.</p></div>
        </div>
        <div className="flex gap-3">
          <Icon name="psychology" className="text-primary text-[22px]" />
          <div><div className="font-semibold text-primary">Model</div>
            <p className="text-text-main text-xs mt-0.5">The specific AI that provider runs for us — like choosing the phone. All providers are set to the same standard model; each just writes its id slightly differently.</p></div>
        </div>
      </Card>

      {msg && <p className={`text-sm mb-3 ${msg.startsWith('Saved') ? 'text-status-approved' : 'text-status-rejected'}`}>{msg}</p>}

      <Card className="overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 font-semibold w-24">Order</th>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Model</th>
              <th className="px-4 py-3 font-semibold">Connection</th>
              <th className="px-4 py-3 font-semibold text-center">On / Off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.provider} className="border-t border-outline-variant align-top">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-primary w-5">{i + 1}</span>
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30" title="Try this provider earlier"><Icon name="arrow_upward" className="text-[16px]" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="disabled:opacity-30" title="Try this provider later"><Icon name="arrow_downward" className="text-[16px]" /></button>
                  </div>
                  <div className="text-[11px] text-outline mt-1">{i === 0 ? 'Tried first' : 'Backup'}</div>
                </td>
                <td className="px-4 py-3 max-w-xs">
                  <div className="font-semibold text-text-main">{r.label}</div>
                  <p className="text-xs text-outline mt-0.5">{r.description}</p>
                </td>
                <td className="px-4 py-3">
                  <ModelPicker provider={r.provider} value={r.model} standard={r.standard_model}
                    onChange={(id) => patch(i, { model: id })} />
                </td>
                <td className="px-4 py-3">
                  {r.available
                    ? <Badge className="bg-status-approved/10 text-status-approved"><Icon name="check_circle" className="text-[14px] mr-1" />Ready</Badge>
                    : <Badge className="bg-status-rejected/10 text-status-rejected"><Icon name="error" className="text-[14px] mr-1" />Not set up</Badge>}
                  {!r.available && <p className="text-[11px] text-outline mt-1">{r.not_ready_hint}</p>}
                </td>
                <td className="px-4 py-3 text-center">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                    <span className={`text-xs font-medium ${r.enabled ? 'text-status-approved' : 'text-outline'}`}>{r.enabled ? 'On' : 'Off'}</span>
                  </label>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-outline">Loading…</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 text-sm">
        <div className="flex items-center gap-2 mb-2"><Icon name="key" className="text-primary" /><span className="font-semibold text-primary">API keys</span></div>
        <p className="text-xs text-text-main mb-3">For security, keys are never entered or shown in the app. They live only on the server (<code>backend/.env</code> locally, Cloud Run secrets when deployed). This page just shows whether each one is present.</p>
        <div className="grid grid-cols-3 gap-3">
          {keys.map(({ name, hint, configured: ok }) => (
            <div key={name} className="border border-outline-variant rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-main text-xs">{name}</span>
                {ok ? <Badge className="bg-status-approved/10 text-status-approved">Configured</Badge> : <Badge className="bg-surface-container text-outline">Not set</Badge>}
              </div>
              <p className="text-[11px] text-outline mt-1">{hint}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
