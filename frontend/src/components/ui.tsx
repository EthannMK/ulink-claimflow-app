import { ReactNode } from 'react'

/** Page header used by every screen: title, one-line description, optional context line and actions. */
export function PageTitle({ title, sub, action, eyebrow, meta }: { title: string; sub?: ReactNode; action?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-outline mb-1">{eyebrow}</div>}
        <h1 className="font-display text-[26px] leading-tight font-bold text-primary tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-text-main mt-1 max-w-3xl">{sub}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-outline">{meta}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface-container-lowest rounded-xl border border-outline-variant/80 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ${className}`}>{children}</div>
}
/** Card title row: icon, title, optional hint and actions on the right. */
export function CardHeader({ icon, title, hint, action, className = '' }: { icon?: string; title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 ${className}`}>
      {icon && <Icon name={icon} className="text-primary text-[20px]" />}
      <h2 className="font-semibold text-[15px] text-on-surface">{title}</h2>
      {hint && <span className="text-xs text-outline">{hint}</span>}
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  )
}
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>
}
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={`material-symbols-outlined select-none ${className}`}>{name}</span>
}
export function StatCard({ label, value, icon, tone = 'primary' }: { label: string; value: string; icon: string; tone?: string }) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl grid place-items-center bg-${tone}/10 text-${tone}`}><Icon name={icon} /></div>
      <div>
        <div className="text-2xl font-bold font-display text-on-surface leading-none tabular-nums">{value}</div>
        <div className="text-xs text-text-main mt-1">{label}</div>
      </div>
    </Card>
  )
}
/** Buttons: primary (main action), accent, outline (secondary), ghost (quiet), danger (destructive).
 *  `loading` shows a spinner and blocks double clicks. */
export function Button({ children, variant = 'primary', size = 'md', className = '', loading = false, disabled, type = 'button', ...p }: any) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors duration-150 disabled:opacity-50 whitespace-nowrap'
  const sizes: Record<string, string> = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm', lg: 'h-10 px-5 text-sm' }
  const variants: Record<string, string> = {
    primary: 'bg-primary text-white hover:bg-primary/90 shadow-sm',
    accent: 'bg-brand-accent text-white hover:bg-brand-accent/90 shadow-sm',
    outline: 'border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
    ghost: 'text-text-main hover:bg-surface-container hover:text-on-surface',
    danger: 'bg-status-rejected text-white hover:bg-status-rejected/90 shadow-sm',
  }
  return (
    <button type={type} className={`${base} ${sizes[size] ?? sizes.md} ${variants[variant] ?? variants.primary} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading && <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}
/** Shown where a list or panel has nothing yet — says what will appear and how to start. */
export function EmptyState({ icon = 'inbox', title, children, action, className = '' }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center text-center gap-2 px-6 py-10 ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-primary/[0.07] text-primary grid place-items-center"><Icon name={icon} className="text-[24px]" /></div>
      <div className="font-semibold text-on-surface">{title}</div>
      {children && <div className="text-sm text-text-main max-w-md">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
/** Grey placeholder bars while data loads. */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`cf-skeleton ${className}`} aria-hidden="true" />
}
export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="grid gap-3 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, c) => <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-3/4' : 'w-1/2'}`} />)}
        </div>
      ))}
    </div>
  )
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
          <div className="font-display font-bold text-primary text-[15px] tracking-tight">Ulink ClaimFlow</div>
          <div className="text-[10px] text-text-main -mt-0.5">AI claims workspace</div>
        </div>
      )}
    </div>
  )
}
