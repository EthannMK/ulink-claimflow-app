import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { usePersistent } from '../lib/persist'
import { DEFAULT_INSURERS, fieldsFor, formTypesOf, type InsurerConfig, type InsurerField, type FormType } from '../lib/insurers'
import { useQueryClient } from '@tanstack/react-query'
import { createManualTicket, uploadTicketDoc } from '../lib/jd1'
import { backendOn } from '../lib/auth'

const REQUEST_TYPES: [string, string][] = [['New claim (reimbursement)', 'new_claim'], ['LOG request', 'log_request'], ['Query', 'query'], ['Complaint', 'complaint'], ['Payment follow-up', 'payment_followup']]
const CHANNELS: [string, string][] = [['Email', 'email'], ['Viber', 'viber'], ['Facebook', 'facebook'], ['Telegram', 'telegram'], ['Web form', 'webform'], ['Call Center', 'phone']]

export function NewClaimPage() {
  const nav = useNavigate()
  const [insurers] = usePersistent<InsurerConfig[]>('settings.insurers.v3', DEFAULT_INSURERS)
  const [insurerId, setInsurerId] = useState(insurers[0]?.id ?? '')
  const [requestType, setRequestType] = useState('New claim (reimbursement)')
  const [channel, setChannel] = useState('Email')
  const [values, setValues] = useState<Record<string, string>>({})
  const [member, setMember] = useState('')
  const [claimNo, setClaimNo] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [docs, setDocs] = useState<File[]>([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const qc = useQueryClient()
  const insurer = useMemo(() => insurers.find((i) => i.id === insurerId), [insurers, insurerId])
  const formType: FormType = requestType === 'LOG request' ? 'log' : 'claim'
  const availForms = insurer ? formTypesOf(insurer) : []
  const hasForm = availForms.includes(formType)
  const formFields = hasForm ? fieldsFor(insurer, formType) : []
  const sections = useMemo(() => {
    const order: string[] = []
    for (const f of formFields) if (!order.includes(f.section || '')) order.push(f.section || '')
    return order
  }, [formFields])
  const field = 'w-full text-sm border border-outline-variant rounded-md px-3 py-2 bg-surface'

  async function create() {
    setErr('')
    if (!member.trim()) { setErr('Enter the member name.'); return }
    const missing = formFields.filter((f) => f.required && !(values[f.id] ?? '').trim()).map((f) => f.label)
    if (missing.length) { setErr(`Fill in: ${missing.join(', ')}`); return }
    if (!backendOn()) { setErr('Connect the backend to create tickets.'); return }
    setBusy('Creating the ticket…')
    try {
      const t = await createManualTicket({
        insurer: insurer?.name ?? '', member_name: member, claim_no: claimNo, amount, summary: notes,
        category: REQUEST_TYPES.find(([l]) => l === requestType)?.[1] ?? 'new_claim',
        channel: CHANNELS.find(([l]) => l === channel)?.[1] ?? 'email',
        fields: Object.fromEntries(formFields.map((f) => [f.label, values[f.id] ?? ''])),
      })
      const failed: string[] = []
      for (let i = 0; i < docs.length; i++) {
        setBusy(`Saving document ${i + 1} of ${docs.length}…`)
        try { await uploadTicketDoc(t.id, docs[i]) } catch { failed.push(docs[i].name) }
      }
      qc.invalidateQueries({ queryKey: ['claims'] })
      nav(`/claim/${t.id}`, { state: failed.length ? { flash: `Ticket created, but these files could not be saved: ${failed.join(', ')}` } : undefined })
    } catch (e: any) { setErr(e?.message ?? 'Could not create the ticket'); setBusy('') }
  }

  function renderField(f: InsurerField) {
    const v = values[f.id] ?? ''
    const set = (val: string) => setValues({ ...values, [f.id]: val })
    const common = { className: field, value: v, onChange: (e: any) => set(e.target.value) }
    return (
      <div key={f.id} className={f.type === 'textarea' ? 'col-span-2' : ''}>
        <label className="block text-sm font-medium mb-1">{f.label}{f.required && <span className="text-status-rejected"> *</span>}</label>
        {f.type === 'textarea' ? <textarea rows={3} {...common} />
          : f.type === 'select' ? <select {...common}><option value="">—</option>{(f.options || '').split(',').filter(Boolean).map((o) => <option key={o}>{o.trim()}</option>)}</select>
          : <input type={f.type === 'date' ? 'date' : 'text'} placeholder={f.aiHint} {...common} />}
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <PageTitle title="New Claim" sub="Log a claim manually. Fields adapt to the selected insurer (managed in Settings → Insurers & Fields)." />
      {(
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="block text-sm font-medium mb-1">Insurer</label>
              <select className={field} value={insurerId} onChange={(e) => { setInsurerId(e.target.value); setValues({}) }}>{insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Request type</label>
              <select className={field} value={requestType} onChange={(e) => setRequestType(e.target.value)}>{REQUEST_TYPES.map(([l]) => <option key={l}>{l}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Channel</label>
              <select className={field} value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map(([l]) => <option key={l}>{l}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Member name <span className="text-status-rejected">*</span></label>
              <input className={field} value={member} onChange={(e) => setMember(e.target.value)} placeholder="As on the policy" /></div>
            <div><label className="block text-sm font-medium mb-1">Insurer claim no.</label>
              <input className={field} value={claimNo} onChange={(e) => setClaimNo(e.target.value)} placeholder="If known" /></div>
            <div><label className="block text-sm font-medium mb-1">Amount (MMK)</label>
              <input className={field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 255,300" /></div>
            <div className="col-span-2"><label className="block text-sm font-medium mb-1">Notes</label>
              <textarea rows={2} className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What the member asked for, who called, etc." /></div>
          </div>

          {!insurer ? null : !hasForm ? (
            <p className="text-sm text-outline">{insurer.name} has no {formType === 'log' ? 'LOG request' : 'claim'} form
              {availForms.length > 0 ? <> — it supports {availForms.map((t) => t === 'log' ? 'LOG request' : 'claim').join(' & ')} only. Change the request type above.</> : <>. Add its fields in <b>Settings → Insurers & Fields</b>.</>}</p>
          ) : formFields.length > 0 ? (
            <div className="space-y-4">
              {sections.map((sec) => (
                <div key={sec || 'none'}>
                  {sec && <div className="text-[11px] font-semibold uppercase tracking-wide text-primary/70 mb-2">{sec}</div>}
                  <div className="grid grid-cols-2 gap-4">{formFields.filter((f) => (f.section || '') === sec).map(renderField)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-outline">No fields configured for this {formType === 'log' ? 'LOG request' : 'claim'} form yet. Add them in <b>Settings → Insurers & Fields</b>.</p>
          )}

          <label className="mt-4 block border-2 border-dashed border-outline-variant rounded-lg p-5 text-center text-sm text-text-main cursor-pointer hover:bg-surface-container/50">
            <Icon name="upload_file" className="text-[28px] text-outline" />
            <div>{docs.length ? `${docs.length} document(s) attached — click to change` : 'Attach documents (claim form, invoices, medical reports) — they are kept with the ticket'}</div>
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => setDocs(Array.from(e.target.files ?? []))} />
          </label>
          {docs.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{docs.map((d) => <span key={d.name} className="text-xs bg-surface-container rounded px-2 py-0.5">{d.name}</span>)}</div>}
          <p className="text-xs text-outline mt-2">To have the AI read a claim packet, use <button className="text-primary hover:underline" onClick={() => nav('/jd1')}>JD1 · Doc Scan</button> instead — it creates the ticket for you.</p>
          {err && <p className="text-sm text-status-rejected mt-3">{err}</p>}
          <div className="mt-4 flex gap-2">
            <Button onClick={create} loading={!!busy} disabled={!!busy}>{busy || 'Create ticket'}</Button>
            <Button variant="ghost" onClick={() => nav('/inbox')} disabled={!!busy}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
