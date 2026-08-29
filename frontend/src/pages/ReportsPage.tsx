import { useState } from 'react'
import * as XLSX from 'xlsx'
import { PageTitle, Card, Button, Icon, Badge } from '../components/ui'
import { mockClaims } from '../mocks/claims'
import { mockConfirmations } from '../mocks/confirmations'
import { genId } from '../lib/persist'

// fuzzy column getter: matches header names ignoring case/spaces/punctuation
function col(row: any, ...names: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const n of names) {
    const k = Object.keys(row).find((key) => norm(key) === norm(n) || norm(key).includes(norm(n)))
    if (k != null && row[k] != null) return String(row[k])
  }
  return ''
}
function mapConfirmation(r: any) {
  return {
    id: genId(),
    inputDate: col(r, 'inputdate', 'date') || new Date().toISOString().slice(0, 10),
    assignee: col(r, 'assignee', 'owner'), reason: col(r, 'reason'),
    ticket: col(r, 'ticket', 'ticketno'), claim: col(r, 'claim', 'claimno', 'policy'),
    member: col(r, 'member', 'membername', 'patient'), provider: col(r, 'provider', 'hospital', 'clinic'),
    providerPhone: col(r, 'providerphone', 'phone'), insurer: col(r, 'insurer'),
    csr: col(r, 'csr'), status: (col(r, 'status') || 'Pending') as any,
  }
}

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
  const [importMsg, setImportMsg] = useState('')

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target!.result as ArrayBuffer), { type: 'array' })
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[]
        if (!rows.length) { setImportMsg('No rows found in that file.'); return }
        const mapped = rows.map(mapConfirmation)
        const key = 'ulink:confirmations'
        const existing = JSON.parse(localStorage.getItem(key) || '[]')
        localStorage.setItem(key, JSON.stringify([...mapped, ...existing]))
        setImportMsg(`Imported ${mapped.length} record(s) into Provider Confirmation. Open that tab to review.`)
      } catch (err: any) { setImportMsg('Could not read that file: ' + (err?.message ?? 'unknown')) }
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  return (
    <div>
      <PageTitle title="Reports & Analytics" sub="Download raw data across all dimensions and offline Excel dashboards." />

      {/* filters */}
      <Card className="p-4 mb-5 flex flex-wrap items-end gap-4">
        <div><label className="block text-xs text-text-main mb-1">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm border border-outline-variant rounded-md px-2 py-1.5" /></div>
        <div><label className="block text-xs text-text-main mb-1">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm border border-outline-variant rounded-md px-2 py-1.5" /></div>
        <div className="text-xs text-outline ml-auto">Exports reflect the selected range (demo uses sample data).</div>
      </Card>

      {/* import */}
      <Card className="p-5 mb-5 border-l-4 border-primary">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary grid place-items-center"><Icon name="upload_file" className="text-[24px]" /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2"><h3 className="font-semibold">Import your data</h3><Badge className="bg-primary/10 text-primary">CSV · XLSX</Badge></div>
            <p className="text-sm text-text-main">Upload a spreadsheet from your existing system — it loads into the Provider Confirmation register. Columns are matched by name (member, provider, insurer, ticket, status…).</p>
            {importMsg && <p className="text-xs text-status-approved mt-1">{importMsg}</p>}
          </div>
          <label className="inline-flex items-center gap-1.5 rounded-lg font-semibold px-4 py-2 text-sm bg-primary text-white hover:bg-primary-dark shadow-sm cursor-pointer">
            <Icon name="upload" className="text-[18px]" /> Choose file
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport} />
          </label>
        </div>
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
