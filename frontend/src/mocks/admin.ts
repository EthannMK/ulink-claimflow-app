export const mockChannels = [
  { name: 'Email', icon: 'mail', connected: true, last: '2 min ago', note: 'lifereclaim@ulinkassist.com' },
  { name: 'Facebook', icon: 'thumb_up', connected: true, last: '5 min ago', note: 'facebook.com/ulinkmyanmar' },
  { name: 'Web form', icon: 'language', connected: true, last: '1 min ago', note: 'Formcraft → inbox' },
  { name: 'Phone', icon: 'call', connected: true, last: 'manual', note: 'Call centre logs' },
  { name: 'Viber', icon: 'chat', connected: false, last: '—', note: 'Business channel — planned' },
  { name: 'Telegram', icon: 'send', connected: false, last: '—', note: 'Not in use yet' },
]
export const mockSla = [
  { category: 'New claim', target: '24 h', warn: '18 h', breach: '24 h' },
  { category: 'LOG (emergency)', target: '3 h', warn: '2 h', breach: '3 h' },
  { category: 'LOG (non-emergency)', target: '24 h', warn: '18 h', breach: '24 h' },
  { category: 'Query', target: '24 h', warn: '20 h', breach: '24 h' },
  { category: 'Complaint', target: '24 h', warn: '12 h', breach: '24 h' },
  { category: 'Payment follow-up', target: '48 h', warn: '36 h', breach: '48 h' },
]
export const mockRouting = [
  { when: 'Channel = Email/Web + Type = New claim', assign: 'JD1 team (round-robin)' },
  { when: 'Type = LOG request', assign: 'LOG team (JD2)' },
  { when: 'Type = Complaint', assign: 'Complaint officer' },
  { when: 'Amount ≥ 300,000 MMK', assign: 'JD3 (doctors)' },
  { when: 'Type = Payment follow-up', assign: 'JD4 (payment)' },
]
export const mockAudit = [
  { time: '2026-08-14 09:15', user: 'AI', action: 'Categorised & suggested assignee', item: 'CLM-26001' },
  { time: '2026-08-14 09:22', user: 'Aung Ko (JD1)', action: 'Approved AI summary, passed to JD2', item: 'CLM-26001' },
  { time: '2026-08-14 10:05', user: 'AI', action: 'Flagged LOG > USD 1,000 (insurer approval)', item: 'LOG-26014' },
  { time: '2026-08-14 10:40', user: 'Su Su (JD2)', action: 'Overrode AI decision (partial → full)', item: 'CLM-25990' },
  { time: '2026-08-14 11:20', user: 'AI', action: 'Routed complaint to complaint officer', item: 'CMP-26007' },
  { time: '2026-08-14 11:35', user: 'Admin', action: 'Updated SLA policy for LOG', item: 'settings' },
]
export const roleCaps = [
  'View all claims', 'Work claims', 'Reassign', 'Approve / reject',
  'Connect channels', 'Manage users', 'Manage rules', 'View reports', 'View audit log', 'Change settings',
]
export const roleCols = ['Admin', 'JD1', 'JD2', 'JD3', 'CSR']
export const roleMatrix: Record<string, boolean[]> = {
  // one row per capability (order = roleCaps); columns = roleCols
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
