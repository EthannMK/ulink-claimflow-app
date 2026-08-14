export interface Notif { id: string; icon: string; text: string; ref: string; at: string; unread: boolean }
export const mockNotifs: Notif[] = [
  { id:'n1', icon:'assignment_ind', text:'New claim assigned to you', ref:'CLM-26001', at:'2026-08-14T09:15:00Z', unread:true },
  { id:'n2', icon:'smart_toy', text:'AI finished processing a claim', ref:'CLM-26002', at:'2026-08-14T08:45:00Z', unread:true },
  { id:'n3', icon:'schedule', text:'SLA nearing breach', ref:'CMP-26007', at:'2026-08-14T07:50:00Z', unread:false },
  { id:'n4', icon:'alternate_email', text:'You were mentioned in a note', ref:'LOG-26014', at:'2026-08-13T18:20:00Z', unread:false },
]
