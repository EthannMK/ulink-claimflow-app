// Structural scaffolding only — no demo/operational data.
// Editable config (channels, SLA, routing, roles, settings) persists per-browser via lib/persist.

// Available channel types (structure). `glyph` is a Material icon name or a brand key
// (facebook/viber/telegram) rendered by ChannelGlyph. All start disconnected.
export const mockChannels = [
  { name: 'Email', glyph: 'mail', connected: false, last: '—', note: '' },
  { name: 'Facebook', glyph: 'facebook', connected: false, last: '—', note: '' },
  { name: 'Web form', glyph: 'language', connected: false, last: '—', note: '' },
  { name: 'Call Center', glyph: 'support_agent', connected: false, last: '—', note: '' },
  { name: 'Viber', glyph: 'viber', connected: false, last: '—', note: '' },
  { name: 'Telegram', glyph: 'telegram', connected: false, last: '—', note: '' },
]

export const mockSla: { category: string; target: string; warn: string; breach: string }[] = []
export const mockRouting: { when: string; assign: string }[] = []
export const mockAudit: { time: string; user: string; action: string; item: string }[] = []

// Permission framework (structure, not demo data). Columns = roles; rows = capabilities.
export const roleCols = ['Super Admin', 'Admin', 'JD1', 'JD2', 'JD3', 'CSR']
export const roleCaps = [
  'View all claims', 'Work claims', 'Reassign tickets', 'Bulk assign tickets', 'Approve / reject',
  'View documents', 'Upload documents', 'Delete documents', 'Connect channels', 'Manage users',
  'Manage routing & SLA', 'Manage settings & insurers', 'Import data', 'Send broadcast',
  'View reports', 'View audit log',
]
//                                Super   Admin   JD1    JD2    JD3    CSR
export const roleMatrix: Record<string, boolean[]> = {
  'View all claims':            [true,  true,  false, false, false, false],
  'Work claims':                [true,  true,  true,  true,  true,  true ],
  'Reassign tickets':           [true,  true,  false, false, false, false],
  'Bulk assign tickets':        [true,  true,  false, false, false, false],
  'Approve / reject':           [true,  true,  false, true,  true,  false],
  'View documents':             [true,  true,  true,  true,  true,  true ],
  'Upload documents':           [true,  true,  true,  true,  true,  true ],
  'Delete documents':           [true,  false, false, false, false, false],
  'Connect channels':           [true,  true,  false, false, false, false],
  'Manage users':               [true,  false, false, false, false, false],
  'Manage routing & SLA':       [true,  true,  false, false, false, false],
  'Manage settings & insurers': [true,  true,  false, false, false, false],
  'Import data':                [true,  true,  false, false, false, false],
  'Send broadcast':             [true,  true,  false, false, false, false],
  'View reports':               [true,  true,  false, false, false, false],
  'View audit log':             [true,  false, false, false, false, false],
}
