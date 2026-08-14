import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTitle, Card, Button, Icon } from '../components/ui'

export function NewClaimPage() {
  const nav = useNavigate()
  const [done, setDone] = useState(false)
  const field = 'w-full text-sm border border-outline-variant rounded-md px-3 py-2 bg-white'
  return (
    <div className="max-w-3xl">
      <PageTitle title="New Claim" sub="Log a claim or LOG request manually. (AI normally creates these automatically from the inbox.)" />
      {done ? (
        <Card className="p-8 text-center">
          <Icon name="check_circle" className="text-status-approved text-[40px]" />
          <p className="mt-2 font-semibold">Claim created</p>
          <p className="text-sm text-text-main">It has been added to the inbox and routed for review.</p>
          <div className="mt-4"><Button onClick={() => nav('/inbox')}>Go to inbox</Button></div>
        </Card>
      ) : (
        <Card className="p-6 grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">Member name</label><input className={field} placeholder="e.g. Thin Zar" /></div>
          <div><label className="block text-sm font-medium mb-1">Policy number</label><input className={field} placeholder="e.g. MG-100234" /></div>
          <div><label className="block text-sm font-medium mb-1">Insurer</label>
            <select className={field}><option>MGEN</option><option>AYA Sompo</option><option>Myanma Insurance</option><option>Daiichi Life</option><option>KBZ Life</option><option>Singlife</option><option>AMI</option><option>Manulife</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Request type</label>
            <select className={field}><option>New claim (reimbursement)</option><option>LOG request</option><option>Query</option><option>Complaint</option><option>Payment follow-up</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Channel</label>
            <select className={field}><option>Email</option><option>Viber</option><option>Facebook</option><option>Web form</option><option>Phone</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Claimed amount (MMK)</label><input className={field} placeholder="e.g. 185000" /></div>
          <div className="col-span-2"><label className="block text-sm font-medium mb-1">Diagnosis / notes</label><textarea rows={3} className={field} placeholder="Short description of the treatment or request" /></div>
          <div className="col-span-2 border-2 border-dashed border-outline-variant rounded-lg p-6 text-center text-sm text-text-main">
            <Icon name="upload_file" className="text-[28px] text-outline" />
            <div>Drag &amp; drop documents here, or click to browse (claim form, invoices, medical reports)</div>
          </div>
          <div className="col-span-2 flex gap-2">
            <Button onClick={() => setDone(true)}>Create claim</Button>
            <Button variant="ghost" onClick={() => nav('/inbox')}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
