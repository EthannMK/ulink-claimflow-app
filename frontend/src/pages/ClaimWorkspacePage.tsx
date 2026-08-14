import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getClaim } from '../lib/api'
import { Card, Badge, Icon, Button } from '../components/ui'
import { categoryMeta, statusMeta, confidenceCls } from '../lib/format'

const steps = ['Received', 'Category detected', 'Documents scanned', 'Data extracted', 'Completeness checked', 'Policy benefits checked', 'Summary ready', 'Ready for review']

export function ClaimWorkspacePage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: c, isLoading } = useQuery({ queryKey: ['claim', id], queryFn: () => getClaim(id!) })
  if (isLoading) return <p className="text-outline">Loading…</p>
  if (!c) return <p className="text-outline">Claim not found.</p>
  const activeStep = c.documentsComplete ? steps.length : 4

  return (
    <div>
      <button onClick={() => nav('/inbox')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary">
        <Icon name="arrow_back" className="text-[18px]" /> Back to inbox
      </button>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold text-primary">{c.reference}</h1>
        <Badge className={categoryMeta[c.category].cls}>{categoryMeta[c.category].label}</Badge>
        <Badge className={statusMeta[c.status].cls}>{statusMeta[c.status].label}</Badge>
        <span className="text-sm text-text-main">{c.memberName} · {c.insurer}</span>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT: documents */}
        <Card className="col-span-3 p-4">
          <h3 className="font-semibold text-on-surface mb-3 text-sm">Documents</h3>
          {c.documents.length === 0 && <p className="text-xs text-outline">No documents yet.</p>}
          <div className="space-y-2">
            {c.documents.map((d) => (
              <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container">
                <Icon name="description" className="text-[20px] text-primary" />
                <div className="min-w-0">
                  <div className="text-sm truncate">{d.name}</div>
                  <div className="text-xs text-outline">{d.pages ?? 1} page(s)</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* CENTER: pipeline + fields */}
        <div className="col-span-5 space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-on-surface mb-3 text-sm">AI pipeline</h3>
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <Icon name={i < activeStep ? 'check_circle' : 'radio_button_unchecked'}
                    className={`text-[18px] ${i < activeStep ? 'text-status-approved' : 'text-outline-variant'}`} />
                  <span className={i < activeStep ? 'text-on-surface' : 'text-outline'}>{s}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-on-surface mb-3 text-sm">Extracted data <span className="text-status-ai font-normal">· AI</span></h3>
            {c.extracted.length === 0 && <p className="text-xs text-outline">Nothing extracted yet.</p>}
            <div className="space-y-2">
              {c.extracted.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <div className="w-36 text-xs text-text-main">{f.key}</div>
                  <input defaultValue={f.value} className="flex-1 text-sm border border-outline-variant rounded-md px-2 py-1" />
                  <Badge className={confidenceCls(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-outline mt-2">Amber/red confidence = please verify (often handwritten fields).</p>
          </Card>
        </div>

        {/* RIGHT: checklist + summary + actions */}
        <div className="col-span-4 space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-on-surface mb-3 text-sm">Document checklist</h3>
            {['Claim form', 'Itemised invoice', 'Medical report', 'ID copy'].map((d, i) => {
              const have = c.documentsComplete || i < c.documents.length
              return (
                <div key={d} className="flex items-center gap-2 text-sm py-1">
                  <Icon name={have ? 'check_circle' : 'cancel'} className={`text-[18px] ${have ? 'text-status-approved' : 'text-status-rejected'}`} />
                  <span className={have ? 'text-on-surface' : 'text-text-main'}>{d}</span>
                </div>
              )
            })}
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-on-surface mb-2 text-sm">AI summary</h3>
            <p className="text-sm text-text-main leading-relaxed">{c.summary}</p>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-on-surface mb-2 text-sm">Draft reply</h3>
            <textarea rows={3} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1"
              defaultValue={c.documentsComplete ? 'Thank you, your claim is complete and under review.' : 'Dear member, please send the missing itemised invoice to proceed.'} />
            <div className="flex flex-wrap gap-2 mt-3">
              <Button>Approve &amp; send</Button>
              <Button variant="outline">Request docs</Button>
              <Button variant="ghost">Reassign</Button>
              <Button variant="ghost">Pass to JD2</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
