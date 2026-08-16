import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getClaim } from '../lib/api'
import { Card, Badge, Icon, Button } from '../components/ui'
import { categoryMeta, statusMeta, confidenceCls } from '../lib/format'

const steps = ['Received', 'Category detected', 'Documents scanned', 'Data extracted', 'Completeness checked', 'Policy benefits checked', 'Summary ready', 'Ready for review']
function SectionHead({ icon, title, tone = 'primary', extra }: { icon: string; title: string; tone?: string; extra?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`w-7 h-7 rounded-lg bg-${tone}/10 text-${tone} grid place-items-center`}><Icon name={icon} className="text-[16px]" /></div>
      <h3 className="font-semibold text-on-surface text-sm">{title}</h3>
      {extra && <span className="ml-auto text-xs text-status-ai font-medium">{extra}</span>}
    </div>
  )
}
export function ClaimWorkspacePage() {
  const { id } = useParams(); const nav = useNavigate()
  const { data: c, isLoading } = useQuery({ queryKey: ['claim', id], queryFn: () => getClaim(id!) })
  if (isLoading) return <p className="text-outline">Loading…</p>
  if (!c) return <p className="text-outline">Claim not found.</p>
  const active = c.documentsComplete ? steps.length : 4

  return (
    <div>
      <button onClick={() => nav('/inbox')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary"><Icon name="arrow_back" className="text-[18px]" /> Back to inbox</button>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center"><Icon name="description" /></div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-primary tracking-tight">{c.reference}</h1>
            <Badge className={categoryMeta[c.category].cls}>{categoryMeta[c.category].label}</Badge>
            <Badge className={statusMeta[c.status].cls}>{statusMeta[c.status].label}</Badge>
          </div>
          <div className="text-sm text-text-main">{c.memberName} · {c.insurer}{c.amount ? ` · ${c.amount.toLocaleString()} MMK` : ''}</div>
        </div>
        <div className="ml-auto flex gap-2"><Button variant="outline">Reassign</Button><Button>Pass to JD2</Button></div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-3 p-4 h-fit">
          <SectionHead icon="folder" title="Documents" />
          {c.documents.length === 0 && <p className="text-xs text-outline">No documents yet.</p>}
          <div className="space-y-2">
            {c.documents.map((d) => (
              <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container hover:bg-surface-container/70">
                <div className="w-8 h-8 rounded-lg bg-white grid place-items-center shrink-0"><Icon name="description" className="text-[18px] text-primary" /></div>
                <div className="min-w-0"><div className="text-sm truncate">{d.name}</div><div className="text-xs text-outline">{d.pages ?? 1} page(s)</div></div>
              </div>
            ))}
          </div>
        </Card>

        <div className="col-span-5 space-y-4">
          <Card className="p-4">
            <SectionHead icon="smart_toy" title="AI pipeline" tone="status-ai" />
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <Icon name={i < active ? 'check_circle' : 'radio_button_unchecked'} className={`text-[18px] ${i < active ? 'text-status-approved' : 'text-outline-variant'}`} />
                  <span className={i < active ? 'text-on-surface' : 'text-outline'}>{s}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <SectionHead icon="data_object" title="Extracted data" tone="status-ai" extra="· AI" />
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

        <div className="col-span-4 space-y-4">
          <Card className="p-4">
            <SectionHead icon="checklist" title="Document checklist" tone="status-approved" />
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
            <SectionHead icon="notes" title="AI summary" tone="brand-accent" />
            <p className="text-sm text-text-main leading-relaxed">{c.summary}</p>
          </Card>
          <Card className="p-4">
            <SectionHead icon="reply" title="Draft reply" />
            <textarea rows={3} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1" defaultValue={c.documentsComplete ? 'Thank you, your claim is complete and under review.' : 'Dear member, please send the missing itemised invoice to proceed.'} />
            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm">Approve &amp; send</Button>
              <Button size="sm" variant="outline">Request docs</Button>
              <Button size="sm" variant="ghost">Pass to JD2</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
