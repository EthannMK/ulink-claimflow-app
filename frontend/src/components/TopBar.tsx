export function TopBar() {
  return (
    <header className="h-16 bg-white border-b border-outline-variant flex items-center gap-4 px-6">
      <div className="flex-1 max-w-md">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[20px] text-outline">search</span>
          <input placeholder="Search claims, members, tickets…" className="bg-transparent outline-none text-sm w-full" />
        </div>
      </div>
      <button className="material-symbols-outlined text-outline">notifications</button>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary text-white grid place-items-center text-sm">A</div>
        <span className="text-sm text-text-main">Admin</span>
      </div>
    </header>
  )
}
