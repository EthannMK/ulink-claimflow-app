import type { User } from '../lib/types'
export const mockUsers: User[] = [
  { id: 'u1', name: 'Aung Ko', email: 'aung@ulink.com', role: 'jd1', team: 'Intake', active: true },
  { id: 'u2', name: 'Su Su', email: 'susu@ulink.com', role: 'jd2', team: 'Adjudication', active: true },
  { id: 'u3', name: 'Dr. Hla', email: 'hla@ulink.com', role: 'jd3', team: 'Medical', active: true },
  { id: 'u4', name: 'Mya Mya', email: 'mya@ulink.com', role: 'csr', team: 'Call Center', active: true },
  { id: 'u5', name: 'Admin', email: 'admin@ulink.com', role: 'admin', team: 'Ops', active: true },
]
