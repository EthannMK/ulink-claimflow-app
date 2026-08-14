import { ReactNode } from 'react'

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary">{title}</h1>
        {sub && <p className="text-sm text-text-main mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  )
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-outline-variant ${className}`}>{children}</div>
}
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{children}</span>
}
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}
export function StatCard({ label, value, icon, tone = 'primary' }: { label: string; value: string; icon: string; tone?: string }) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg grid place-items-center bg-${tone}/10 text-${tone}`}>
        <Icon name={icon} />
      </div>
      <div>
        <div className="text-2xl font-bold font-display text-on-surface">{value}</div>
        <div className="text-xs text-text-main">{label}</div>
      </div>
    </Card>
  )
}
export function Button({ children, variant = 'primary', ...p }: any) {
  const base = 'px-4 py-2 rounded-lg text-sm font-semibold transition-colors'
  const styles: Record<string, string> = {
    primary: 'bg-primary text-white hover:bg-primary-dark',
    ghost: 'bg-surface-container text-text-main hover:bg-outline-variant',
    outline: 'border border-outline-variant text-text-main hover:bg-surface-container',
  }
  return <button className={`${base} ${styles[variant]}`} {...p}>{children}</button>
}
