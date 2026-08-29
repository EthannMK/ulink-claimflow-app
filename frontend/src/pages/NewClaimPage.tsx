import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { usePersistent } from '../lib/persist'
import { DEFAULT_INSURERS, type InsurerConfig, type InsurerField } from '../lib/insurers'

export function NewClaimPage() {
  const nav = useNavigate()
  const [insurers] = usePersistent<InsurerConfig[]>('settings.insurers', DEFAULT_INSURERS)
  const [insurerId, setInsurerId] = useState(insurers[0]?.id ?? '')
  const [requestType, setRequestType] = useState('New claim (reimbursement)')
  const [channel, setChannel] = useState('Email')
  const [values, setValues] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)
  const insurer = useMemo(() => insurers.find((i) => i.id === insurerId), [insurers, insurerId])
  const field = 'w-full text-sm border border-outline-variant rounded-md px-3 py-2 bg-white'

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
      {done ? (
        <Card className="p-8 text-center">
          <Icon name="check_circle" className="text-status-approved text-[40px]" />
          <p className="mt-2 font-semibold">Claim created</p>
          <p className="text-sm text-text-main">It has been added to the inbox and routed for review.</p>
          <div className="mt-4"><Button onClick={() => nav('/inbox')}>Go to inbox</Button></div>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="block text-sm font-medium mb-1">Insurer</label>
              <select className={field} value={insurerId} onChange={(e) => { setInsurerId(e.target.value); setValues({}) }}>{insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Request type</label>
              <select className={field} value={requestType} onChange={(e) => setRequestType(e.target.value)}><option>New claim (reimbursement)</option><option>LOG request</option><option>Query</option><option>Complaint</option><option>Payment follow-up</option></select></div>
            <div><label className="block text-sm font-medium mb-1">Channel</label>
              <select className={field} value={channel} onChange={(e) => setChannel(e.target.value)}><option>Email</option><option>Viber</option><option>Facebook</option><option>Telegram</option><option>Web form</option><option>Call Center</option></select></div>
          </div>

          {insurer && insurer.fields.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">{insurer.fields.map(renderField)}</div>
          ) : (
            <p className="text-sm text-outline">No fields configured for this insurer yet. Add them in <b>Settings → Insurers & Fields</b>.</p>
          )}

          <div className="mt-4 border-2 border-dashed border-outline-variant rounded-lg p-6 text-center text-sm text-text-main">
            <Icon name="upload_file" className="text-[28px] text-outline" />
            <div>Attach documents (claim form, invoices, medical reports) — or use JD1 Assistant to auto-read a packet.</div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setDone(true)}>Create claim</Button>
            <Button variant="ghost" onClick={() => nav('/inbox')}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
