import { useState } from 'react'
import * as XLSX from 'xlsx'
import { PageTitle, Card, Button, Icon, Badge } from '../components/ui'
import { mockClaims } from '../mocks/claims'
import { mockConfirmations } from '../mocks/confirmations'

const rawRows = () => mockClaims.map((c) => ({
  Reference: c.reference, Channel: c.channel, Category: c.category, Status: c.status,
  Insurer: c.insurer, Member: c.memberName, Policy: c.policyNumber ?? '', Amount: c.amount ?? '',
  DocumentsComplete: c.documentsComplete, ReceivedAt: c.receivedAt,
}))
const countBy = (key: string) => {
  const m: Record<string, number> = {}
  mockClaims.forEach((c: any) => { const k = String(c[key]); m[k] = (m[k] ?? 0) + 1 })
  return Object.entries(m).map(([k, v]) => ({ [key]: k, Count: v }))
}
function downloadCsv(rows: any[], name: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
function downloadWorkbook() {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawRows()), 'Raw claims')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(countBy('insurer')), 'By insurer')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(countBy('channel')), 'By channel')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(countBy('category')), 'By category')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(countBy('status')), 'By status')
  XLSX.writeFile(wb, 'ulink-claimflow-dashboard.xlsx')
}

const reports = [
  { name: 'Raw claims data (all dimensions)', desc: 'Every claim with all fields — channel, category, status, insurer, member, amount, dates.', rows: rawRows, file: 'claims-raw' },
  { name: 'Volume by insurer', desc: 'Claim counts grouped by insurer.', rows: () => countBy('insurer'), file: 'by-insurer' },
  { name: 'Volume by channel', desc: 'Claim counts grouped by intake channel.', rows: () => countBy('channel'), file: 'by-channel' },
  { name: 'Volume by category', desc: 'New claim, LOG, query, complaint, payment.', rows: () => countBy('category'), file: 'by-category' },
  { name: 'Status breakdown', desc: 'Distribution across processing statuses.', rows: () => countBy('status'), file: 'by-status' },
  { name: 'Provider confirmation log', desc: 'CSR confirmation records with status.', rows: () => mockConfirmations, file: 'confirmations' },
]

export function ReportsPage() {
  const [from, setFrom] = useState('2026-08-01')
  const [to, setTo] = useState('2026-08-31')
  return (
    <div>
      <PageTitle title="Reports & Analytics" sub="Download raw data across all dimensions and offline Excel dashboards." />

      {/* filters */}
      <Card className="p-4 mb-5 flex flex-wrap items-end gap-4">
        <div><label className="block text-xs text-text-main mb-1">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm border border-outline-variant rounded-md px-2 py-1.5" /></div>
        <div><label className="block text-xs text-text-main mb-1">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm border border-outline-variant rounded-md px-2 py-1.5" /></div>
        <div className="text-xs text-outline ml-auto">Exports reflect the selected range (demo uses sample data).</div>
      </Card>

      {/* featured Excel dashboard */}
      <Card className="p-5 mb-5 border-l-4 border-status-approved">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-status-approved/10 text-status-approved grid place-items-center"><Icon name="table_view" className="text-[24px]" /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2"><h3 className="font-semibold">Offline Excel dashboard</h3><Badge className="bg-status-approved/10 text-status-approved">.xlsx</Badge></div>
            <p className="text-sm text-text-main">One workbook: raw claims + pivot sheets (by insurer, channel, category, status) for offline analysis.</p>
          </div>
          <Button onClick={downloadWorkbook}><Icon name="download" className="text-[18px]" /> Download Excel</Button>
        </div>
      </Card>

      {/* report catalog */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-outline-variant text-xs uppercase tracking-wide text-on-surface-variant bg-surface-container/70 font-semibold">Individual reports</div>
        {reports.map((r) => (
          <div key={r.file} className="flex items-center gap-4 px-5 py-3 border-b border-outline-variant/50 last:border-0 hover:bg-surface-container/40">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon name="description" className="text-[18px]" /></div>
            <div className="flex-1 min-w-0"><div className="text-sm font-medium">{r.name}</div><div className="text-xs text-text-main truncate">{r.desc}</div></div>
            <Button size="sm" variant="outline" onClick={() => downloadCsv(r.rows(), r.file + '.csv')}><Icon name="download" className="text-[16px]" /> CSV</Button>
            <Button size="sm" variant="ghost" onClick={() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.rows()), 'Data'); XLSX.writeFile(wb, r.file + '.xlsx') }}><Icon name="table" className="text-[16px]" /> Excel</Button>
          </div>
        ))}
      </Card>
    </div>
  )
}
