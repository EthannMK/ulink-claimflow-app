import { PageTitle, Card } from '../components/ui'
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <PageTitle title={title} />
      <Card className="p-10 text-center">
        <p className="text-text-main text-sm">This screen is planned. We'll build it out next, with the same layout and live data.</p>
      </Card>
    </div>
  )
}
