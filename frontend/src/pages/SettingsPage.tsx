import { PageTitle, Card, Badge, Icon } from '../components/ui'
export function SettingsPage() {
  return (
    <div>
      <PageTitle title="Settings — Templates, Checklists & Rules" sub="What the AI uses to check and reply (managed by Admin)." />
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3">Reply templates</h3>
          {['Request missing documents', 'Claim received acknowledgement', 'LOG issued', 'Rejection — policy exclusion'].map((t) => (
            <div key={t} className="flex items-center gap-2 text-sm py-1.5 border-b border-outline-variant/40 last:border-0"><Icon name="mail" /> {t}<span className="ml-auto"><Badge className="bg-surface-container">EN · MM</Badge></span></div>
          ))}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3">Document checklists (per insurer)</h3>
          {['AYA Sompo — New claim', 'AYA Sompo — LOG', 'MGEN — New claim', 'MGEN — LOG'].map((t) => (
            <div key={t} className="flex items-center gap-2 text-sm py-1.5 border-b border-outline-variant/40 last:border-0"><Icon name="checklist" /> {t}<button className="ml-auto text-xs text-primary">Edit</button></div>
          ))}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3">Business rules</h3>
          {['60-day submission window', 'ID copy mandatory', 'JD2 authority ≤ 300,000 MMK', 'Vaccination — JD2 can approve'].map((t) => (
            <div key={t} className="flex items-center gap-2 text-sm py-1.5 border-b border-outline-variant/40 last:border-0"><Icon name="gavel" /> {t}</div>
          ))}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3">Tables of Benefits</h3>
          {['AYA Health — 4 plan tiers', 'MGEN Prestige+ Elite', 'Myanma Insurance — MI Health'].map((t) => (
            <div key={t} className="flex items-center gap-2 text-sm py-1.5 border-b border-outline-variant/40 last:border-0"><Icon name="table" /> {t}<button className="ml-auto text-xs text-primary">Edit</button></div>
          ))}
        </Card>
      </div>
    </div>
  )
}
