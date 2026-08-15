import { PageTitle, Card, Button, Icon } from '../components/ui'
import { mockRouting } from '../mocks/admin'
export function RoutingPage() {
  return (
    <div>
      <PageTitle title="Routing & Assignment Rules" sub="How AI auto-assigns incoming items. Rules run top to bottom; staff can always reassign." action={<Button>Add rule</Button>} />
      <div className="space-y-3">
        {mockRouting.map((r, i) => (
          <Card key={i} className="p-4 flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-semibold">{i + 1}</div>
            <div className="text-sm"><span className="text-text-main">When </span><span className="font-medium">{r.when}</span></div>
            <Icon name="arrow_forward" className="text-[18px] text-outline" />
            <div className="text-sm"><span className="text-text-main">Assign to </span><span className="font-medium text-primary">{r.assign}</span></div>
            <button className="ml-auto text-xs text-primary">Edit</button>
          </Card>
        ))}
      </div>
    </div>
  )
}
