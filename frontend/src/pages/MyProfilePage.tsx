import { PageTitle, Card, Button } from '../components/ui'
export function MyProfilePage() {
  return (
    <div>
      <PageTitle title="My Profile & Preferences" />
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5 text-center">
          <div className="w-20 h-20 rounded-full bg-primary text-white grid place-items-center text-2xl font-display font-bold mx-auto mb-3">A</div>
          <div className="font-semibold">Admin</div>
          <div className="text-sm text-text-main">admin@ulink.com</div>
          <div className="text-xs text-outline mt-1">Role: Admin · Team: Ops</div>
        </Card>
        <Card className="col-span-2 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display name</label>
            <input defaultValue="Admin" className="w-full text-sm border border-outline-variant rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Language</label>
            <select className="w-full text-sm border border-outline-variant rounded-md px-3 py-2"><option>English</option><option>Burmese</option></select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked /> Email notifications</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked /> In-app notifications</label>
          </div>
          <Button>Save changes</Button>
        </Card>
      </div>
    </div>
  )
}
