import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'
import { mockChannels } from '../mocks/admin'
export function ChannelsPage() {
  return (
    <div>
      <PageTitle title="Channel Connections" sub="Sources feeding the omnichannel inbox (this is a layer on top of channels — not a Freshdesk replacement)." />
      <div className="grid grid-cols-3 gap-4">
        {mockChannels.map((c) => (
          <Card key={c.name} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg bg-surface-container grid place-items-center"><Icon name={c.icon} className="text-[20px] text-primary" /></div>
              <div className="font-semibold text-sm">{c.name}</div>
              <Badge className={`ml-auto ${c.connected ? 'bg-status-approved/10 text-status-approved' : 'bg-on-surface-variant/10 text-on-surface-variant'}`}>{c.connected ? 'Connected' : 'Not connected'}</Badge>
            </div>
            <div className="text-xs text-text-main">{c.note}</div>
            <div className="text-xs text-outline mt-1">Last sync: {c.last}</div>
            <div className="mt-3"><Button variant={c.connected ? 'outline' : 'primary'}>{c.connected ? 'Configure' : 'Connect'}</Button></div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-outline mt-3">Note: some insurers (e.g. AYA Sompo) submit via their own portal, so those arrive tagged by source.</p>
    </div>
  )
}
