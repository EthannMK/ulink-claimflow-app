import { useState } from 'react'
import { PageTitle, Card, Badge, Button } from '../components/ui'
import { ChannelGlyph } from '../components/BrandIcons'
import { mockChannels } from '../mocks/admin'
import { usePersistent } from '../lib/persist'

interface Ch { name: string; glyph: string; connected: boolean; last: string; note: string }

export function ChannelsPage() {
  const [channels, setChannels] = usePersistent<Ch[]>('channels.v2', mockChannels.map((c) => ({ ...c })))
  const [open, setOpen] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [note, setNote] = useState('')

  function disconnect(name: string) { setChannels((cs) => cs.map((c) => c.name === name ? { ...c, connected: false, last: '—' } : c)) }
  function connect(name: string) {
    setChannels((cs) => cs.map((c) => c.name === name ? { ...c, connected: true, last: 'just now', note: note || c.note } : c))
    setOpen(null); setKey(''); setNote('')
  }
  const connectedCount = channels.filter((c) => c.connected).length

  return (
    <div>
      <PageTitle title="Channel Connections" sub="Sources feeding the omnichannel inbox. Connect a channel to start pulling requests from it."
        action={<Badge className="bg-status-approved/10 text-status-approved">{connectedCount}/{channels.length} connected</Badge>} />
      <div className="grid grid-cols-3 gap-4">
        {channels.map((c) => (
          <Card key={c.name} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg bg-surface-container grid place-items-center"><ChannelGlyph glyph={c.glyph} className="text-[20px] text-primary" /></div>
              <div className="font-semibold text-sm">{c.name}</div>
              <Badge className={`ml-auto ${c.connected ? 'bg-status-approved/10 text-status-approved' : 'bg-on-surface-variant/10 text-on-surface-variant'}`}>{c.connected ? 'Connected' : 'Not connected'}</Badge>
            </div>
            {c.note && <div className="text-xs text-text-main">{c.note}</div>}
            <div className="text-xs text-outline mt-1">Last sync: {c.last}</div>
            {open === c.name ? (
              <div className="mt-3 space-y-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Account / address (e.g. claims@ulink.com)" className="w-full text-sm border border-outline-variant rounded-md px-2 py-1.5" />
                <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={`${c.name} API key / token`} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1.5" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => connect(c.name)}>Save & connect</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setKey(''); setNote('') }}>Cancel</Button>
                </div>
                <p className="text-[11px] text-outline">Keys move to server-side Secret Manager when the backend channel adapters are wired.</p>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                {c.connected
                  ? <><Button size="sm" variant="outline" onClick={() => { setOpen(c.name); setNote(c.note) }}>Configure</Button>
                      <Button size="sm" variant="ghost" onClick={() => disconnect(c.name)}>Disconnect</Button></>
                  : <Button size="sm" onClick={() => { setOpen(c.name); setNote('') }}>Connect</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
