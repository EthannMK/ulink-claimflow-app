import { useState } from 'react'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'
import { mockChannels } from '../mocks/admin'

interface Ch { name: string; icon: string; connected: boolean; last: string; note: string }

export function ChannelsPage() {
  const [channels, setChannels] = useState<Ch[]>(() => mockChannels.map((c) => ({ ...c })))
  const [open, setOpen] = useState<string | null>(null)
  const [key, setKey] = useState('')

  function disconnect(name: string) {
    setChannels((cs) => cs.map((c) => c.name === name ? { ...c, connected: false, last: '—' } : c))
  }
  function connect(name: string) {
    // POC: front-end marks it connected. In GCP this posts the credential to the backend channel adapter.
    setChannels((cs) => cs.map((c) => c.name === name ? { ...c, connected: true, last: 'just now' } : c))
    setOpen(null); setKey('')
  }

  const connectedCount = channels.filter((c) => c.connected).length

  return (
    <div>
      <PageTitle title="Channel Connections"
        sub="Sources feeding the omnichannel inbox. Connect a channel to start pulling claims from it."
        action={<Badge className="bg-status-approved/10 text-status-approved">{connectedCount}/{channels.length} connected</Badge>} />

      <div className="grid grid-cols-3 gap-4">
        {channels.map((c) => (
          <Card key={c.name} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg bg-surface-container grid place-items-center"><Icon name={c.icon} className="text-[20px] text-primary" /></div>
              <div className="font-semibold text-sm">{c.name}</div>
              <Badge className={`ml-auto ${c.connected ? 'bg-status-approved/10 text-status-approved' : 'bg-on-surface-variant/10 text-on-surface-variant'}`}>{c.connected ? 'Connected' : 'Not connected'}</Badge>
            </div>
            <div className="text-xs text-text-main">{c.note}</div>
            <div className="text-xs text-outline mt-1">Last sync: {c.last}</div>

            {open === c.name ? (
              <div className="mt-3 space-y-2">
                <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={`${c.name} API key / token`}
                  className="w-full text-sm border border-outline-variant rounded-md px-2 py-1.5" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => connect(c.name)}>Save & connect</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setKey('') }}>Cancel</Button>
                </div>
                <p className="text-[11px] text-outline">Stored server-side (Secret Manager) when hosted — never in the browser.</p>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                {c.connected
                  ? <>
                      <Button size="sm" variant="outline" onClick={() => setOpen(c.name)}>Configure</Button>
                      <Button size="sm" variant="ghost" onClick={() => disconnect(c.name)}>Disconnect</Button>
                    </>
                  : <Button size="sm" onClick={() => setOpen(c.name)}>Connect</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
      <p className="text-xs text-outline mt-3">Connecting is wired to the UI now; the API keys plug into the backend channel adapters once hosted. Some insurers (e.g. AYA Sompo) submit via their own portal, so those arrive tagged by source.</p>
    </div>
  )
}
