// Structural scaffolding only — no demo/operational data.
// Editable config (channels, SLA, routing, roles, settings) persists per-browser via lib/persist.

// Available channel types (structure). All start disconnected; the admin connects them.
export const mockChannels = [
  { name: 'Email', icon: 'mail', connected: false, last: '—', note: '' },
  { name: 'Facebook', icon: 'thumb_up', connected: false, last: '—', note: '' },
  { name: 'Web form', icon: 'language', connected: false, last: '—', note: '' },
  { name: 'Phone', icon: 'call', connected: false, last: '—', note: '' },
  { name: 'Viber', icon: 'chat', connected: false, last: '—', note: '' },
  { name: 'Telegram', icon: 'send', connected: false, last: '—', note: '' },
]

export const mockSla: { category: string; target: string; warn: string; breach: string }[] = []
export const mockRouting: { when: string; assign: string }[] = []
export const mockAudit: { time: string; user: string; action: string; item: string }[] = []

// Permission framework (structure, not demo data).
export const roleCaps = [
  'View all claims', 'Work claims', 'Reassign', 'Approve / reject',
  'Connect channels', 'Manage users', 'Manage rules', 'View reports', 'View audit log', 'Change settings',
]
export const roleCols = ['Admin', 'JD1', 'JD2', 'JD3', 'CSR']
export const roleMatrix: Record<string, boolean[]> = {
  'View all claims':   [true,  false, false, false, false],
  'Work claims':       [true,  true,  true,  true,  true ],
  'Reassign':          [true,  true,  true,  true,  false],
  'Approve / reject':  [true,  false, true,  true,  false],
  'Connect channels':  [true,  false, false, false, false],
  'Manage users':      [true,  false, false, false, false],
  'Manage rules':      [true,  false, false, false, false],
  'View reports':      [true,  false, false, false, false],
  'View audit log':    [true,  false, false, false, false],
  'Change settings':   [true,  false, false, false, false],
}
