import { ReactNode } from 'react'

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-text-main mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  )
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-outline-variant shadow-sm ${className}`}>{children}</div>
}
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>{children}</span>
}
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}
export function StatCard({ label, value, icon, tone = 'primary' }: { label: string; value: string; icon: string; tone?: string }) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl grid place-items-center bg-${tone}/10 text-${tone}`}><Icon name={icon} /></div>
      <div>
        <div className="text-2xl font-bold font-display text-on-surface leading-none">{value}</div>
        <div className="text-xs text-text-main mt-1">{label}</div>
      </div>
    </Card>
  )
}
export function Button({ children, variant = 'primary', size = 'md', ...p }: any) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50'
  const sizes: Record<string, string> = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' }
  const variants: Record<string, string> = {
    primary: 'bg-primary text-white hover:bg-primary-dark shadow-sm',
    accent: 'bg-brand-accent text-white hover:opacity-90 shadow-sm',
    outline: 'border border-outline-variant bg-white text-text-main hover:bg-surface-container',
    ghost: 'text-text-main hover:bg-surface-container',
  }
  return <button className={`${base} ${sizes[size]} ${variants[variant]}`} {...p}>{children}</button>
}
export interface Attachment { name: string; size: number; dataUrl?: string }

function openPreview(a: Attachment) {
  if (!a.dataUrl) return
  const [meta, b64] = a.dataUrl.split(',')
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream'
  const bin = atob(b64); const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([arr], { type: mime }))
  window.open(url, '_blank')
}

export function AttachField({ value, onChange, label = 'Attach file' }: { value?: Attachment; onChange: (a?: Attachment) => void; label?: string }) {
  async function pick(f: File) {
    const base: Attachment = { name: f.name, size: f.size }
    if (f.size <= 1_800_000) {           // small enough to keep for in-app preview (per-browser)
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })
      onChange({ ...base, dataUrl })
    } else onChange(base)                 // too large -> metadata only until server storage
  }
  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      <label className="inline-flex items-center gap-1 text-primary cursor-pointer hover:underline">
        <Icon name="attach_file" className="text-[14px]" />{label}
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.currentTarget.value = '' }} />
      </label>
      {value && <span className="flex items-center gap-1 text-text-main bg-surface-container rounded px-2 py-0.5">
        <Icon name="description" className="text-[13px]" />{value.name} · {Math.round(value.size / 1024)} KB
        {value.dataUrl
          ? <button onClick={() => openPreview(value)} className="text-primary ml-1">Preview</button>
          : <span className="text-outline ml-1">(too large to preview here)</span>}
        <button onClick={() => onChange(undefined)} className="text-status-rejected ml-1">×</button>
      </span>}
    </div>
  )
}
export function Logo({ size = 36, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/brand-logo.png" alt="Ulink" style={{ height: size, width: 'auto' }} />
      {showText && (
        <div className="leading-tight">
          <div className="font-display font-bold text-primary text-[15px]">Ulink ClaimFlow</div>
          <div className="text-[10px] text-text-main -mt-0.5">AI claims workspace</div>
        </div>
      )}
    </div>
  )
}
