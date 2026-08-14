// Mock API layer. Shapes match contracts/openapi.yaml.
// When the backend is ready, set VITE_USE_MOCKS=false and swap fetch() calls in here.
import type { Claim, ClaimList, User } from './types'
import { mockClaims } from '../mocks/claims'
import { mockUsers } from '../mocks/users'
import { mockConfirmations, ConfirmationRecord } from '../mocks/confirmations'
import { mockNotifs, Notif } from '../mocks/notifications'

const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false'
const base = import.meta.env.VITE_API_BASE_URL
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function listClaims(): Promise<ClaimList> {
  if (USE_MOCKS) { await wait(120); return { items: mockClaims, page: 1, total: mockClaims.length } }
  return (await fetch(`${base}/api/claims`)).json()
}
export async function getClaim(id: string): Promise<Claim | undefined> {
  if (USE_MOCKS) { await wait(100); return mockClaims.find((c) => c.id === id) }
  return (await fetch(`${base}/api/claims/${id}`)).json()
}
export async function listUsers(): Promise<User[]> {
  if (USE_MOCKS) { await wait(90); return mockUsers }
  return (await fetch(`${base}/api/users`)).json()
}
export async function listConfirmations(): Promise<ConfirmationRecord[]> {
  await wait(90); return mockConfirmations
}
export async function listNotifs(): Promise<Notif[]> {
  await wait(80); return mockNotifs
}
