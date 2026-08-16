import { Icon } from './ui'
export function TopBar() {
  return (
    <header className="h-16 bg-white border-b border-outline-variant flex items-center gap-4 px-6">
      <div className="flex-1 max-w-md">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="search" className="text-[20px] text-outline" />
          <input placeholder="Search claims, members, tickets…" className="bg-transparent outline-none text-sm w-full placeholder:text-outline" />
        </div>
      </div>
      <button className="relative w-9 h-9 rounded-lg hover:bg-surface-container grid place-items-center">
        <Icon name="notifications" className="text-[20px] text-text-main" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-accent" />
      </button>
      <div className="flex items-center gap-2 pl-2 border-l border-outline-variant">
        <div className="w-8 h-8 rounded-full bg-primary text-white grid place-items-center text-sm font-semibold">A</div>
        <div className="leading-tight">
          <div className="text-sm font-medium text-on-surface">Admin</div>
          <div className="text-[11px] text-outline">Administrator</div>
        </div>
      </div>
    </header>
  )
}
