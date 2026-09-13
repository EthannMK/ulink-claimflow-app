import { Card, Badge, Icon } from './ui'
import type { SupportingAnalysis } from '../lib/jd1'

const CHECK_META: Record<string, { icon: string; cls: string }> = {
  ok: { icon: 'check_circle', cls: 'text-status-approved' },
  warning: { icon: 'warning', cls: 'text-status-pending' },
  fail: { icon: 'cancel', cls: 'text-status-rejected' },
  unclear: { icon: 'help', cls: 'text-outline' },
}

/** Renders supporting-document intelligence: cross-document consistency checks +
 *  a card per supporting document (type, AI summary, key facts, flags). */
export function SupportingReview({ supporting, step }: { supporting?: SupportingAnalysis; step?: string }) {
  if (!supporting || (supporting.documents.length === 0 && supporting.checks.length === 0)) return null
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {step && <Badge className="bg-primary/10 text-primary">{step}</Badge>}
        <Icon name="fact_check" className="text-primary text-[18px]" />
        <h3 className="font-semibold text-sm">Supporting documents</h3>
        {supporting.summary && <span className="text-xs text-outline">{supporting.summary}</span>}
      </div>

      {supporting.checks.length > 0 && (
        <div className="mb-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-outline mb-1">Consistency checks</div>
          {supporting.checks.map((c, i) => {
            const m = CHECK_META[c.status] || CHECK_META.unclear
            return (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Icon name={m.icon} className={`text-[16px] mt-0.5 shrink-0 ${m.cls}`} />
                <span className="min-w-0"><b className="text-on-surface">{c.label}:</b> <span className="text-text-main">{c.detail}</span></span>
              </div>
            )
          })}
        </div>
      )}

      {supporting.documents.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {supporting.documents.map((d, i) => (
            <div key={i} className="border border-outline-variant/60 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="description" className="text-[15px] text-primary shrink-0" />
                <span className="text-sm font-medium truncate flex-1 min-w-0" title={d.name}>{d.name || d.doc_type}</span>
                <Badge className="bg-on-surface-variant/10 text-on-surface-variant shrink-0">{d.doc_type}</Badge>
              </div>
              {d.summary && <p className="text-xs text-text-main mb-1">{d.summary}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-outline">
                {d.provider && <span>Provider: {d.provider}</span>}
                {d.date && <span>Date: {d.date}</span>}
                {d.amount && <span>Amount: {d.amount}</span>}
                {d.diagnosis && <span>Dx: {d.diagnosis}</span>}
                {d.person_name && <span>Name: {d.person_name}</span>}
                {d.page ? <span>p{d.page}</span> : null}
              </div>
              {d.flags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {d.flags.map((f, j) => <Badge key={j} className="bg-status-pending/10 text-status-pending">{f}</Badge>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
