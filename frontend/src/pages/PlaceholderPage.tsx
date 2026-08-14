export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="grid place-items-center h-full text-center">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary mb-2">{title}</h1>
        <p className="text-text-main text-sm max-w-md">
          Screen not built yet. Codex: convert <code>docs/screens/{title}.html</code> into this page,
          using the shared Layout and mock data.
        </p>
      </div>
    </div>
  )
}
