export function StitchScreen({ name }: { name: string }) {
  return (
    <iframe
      src={`/screens/${name}.html`}
      title={name}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
