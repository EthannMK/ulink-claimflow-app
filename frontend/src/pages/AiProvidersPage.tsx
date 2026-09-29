import { useEffect, useState } from 'react'
import { getAiStatus, updateAiSettings, getFeatureModels, saveFeatureModels, type AiProviderStatus, type AiStatus, type FeatureModels, type TaskModels } from '../lib/api'
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

      <TaskModelsCard rows={rows} />

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

/** Which model each AI task uses — e.g. a free model for prompt testing, a paid one for claims.
 *  Blank = the provider's main model (table above). Free models are blocked for tasks that send
 *  claim documents unless the Super Admin explicitly allows it (checked on the server too). */
function TaskModelsCard({ rows }: { rows: AiProviderStatus[] }) {
  const [data, setData] = useState<TaskModels | null>(null)
  const [fm, setFm] = useState<FeatureModels>({})
  const [allowFree, setAllowFree] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  function apply(d: TaskModels) { setData(d); setFm(d.models); setAllowFree(d.allow_free_for_documents) }
  useEffect(() => { getFeatureModels().then(apply).catch((e) => setMsg(String(e?.message ?? e))) }, [])
  function set(task: string, provider: string, model: string) {
    setFm((x) => ({ ...x, [task]: { ...(x[task] ?? {}), [provider]: model } })); setDirty(true); setMsg('')
  }
  async function save() {
    setBusy(true); setMsg('')
    try { apply(await saveFeatureModels(fm, allowFree)); setDirty(false); setMsg('Saved. New AI requests use these models straight away.') }
    catch (e: any) { setMsg(String(e?.message ?? e)) } finally { setBusy(false) }
  }
  const active = rows.filter((r) => r.enabled)
  return (
    <Card className="p-4 mb-4 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="tune" className="text-primary" /><span className="font-semibold text-primary">Model for each AI task</span>
        <Button size="sm" className="ml-auto" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
      <p className="text-xs text-text-main mb-3">Every task uses the main model above unless you pick another one here — for example a <b>free</b> model for prompt testing and the help chat, and a <b>paid</b> model for reading claims. Each pick is per provider, so the backup provider keeps working too.</p>
      {!data ? <p className="text-xs text-outline">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-outline text-left">
              <tr><th className="py-1 pr-3 w-56">Task</th>{active.map((r) => <th key={r.provider} className="py-1 pr-3">{r.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.tasks.map((t) => (
                <tr key={t.name} className="border-t border-outline-variant align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-text-main flex items-center gap-1.5">{t.name}
                      {t.documents && <span title="Sends claim documents"><Icon name="lock" className="text-[13px] text-outline" /></span>}</div>
                    <div className="text-[11px] text-outline">{t.hint}</div>
                  </td>
                  {active.map((r) => {
                    const cur = fm[t.name]?.[r.provider] ?? ''
                    return (
                      <td key={r.provider} className="py-2 pr-3">
                        {cur
                          ? <>
                              <ModelPicker provider={r.provider} value={cur} standard="" onChange={(id) => set(t.name, r.provider, id)} />
                              <button onClick={() => set(t.name, r.provider, '')} className="text-[11px] text-primary hover:underline mt-1">Use the main model</button>
                            </>
                          : <div className="flex items-center gap-2 pt-1"><span className="text-outline">Main model</span>
                              <button onClick={() => set(t.name, r.provider, r.model)} className="text-primary hover:underline">Change</button></div>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label className="flex items-start gap-2 mt-3 text-xs bg-status-pending/5 rounded-lg p-2.5">
        <input type="checkbox" className="mt-0.5" checked={allowFree} onChange={(e) => { setAllowFree(e.target.checked); setDirty(true); setMsg('') }} />
        <span><b>Allow free models for claim documents</b> (tasks with <Icon name="lock" className="text-[12px] align-middle" />). Leave this off for real claims — {data?.free_warning ? data.free_warning.split('. ')[0].toLowerCase() : 'free models may log what you send'}.</span>
      </label>
      {msg && <p className={`text-xs mt-2 ${msg.startsWith('Saved') ? 'text-status-approved' : 'text-status-rejected'}`}>{msg}</p>}
    </Card>
  )
}
