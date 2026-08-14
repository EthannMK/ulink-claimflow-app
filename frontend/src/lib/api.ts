// Mock API layer. Shapes match contracts/openapi.yaml.
// When the backend is ready, set VITE_USE_MOCKS=false and swap fetch() calls in here.
import type { Claim, ClaimList, User } from './types'
import { mockClaims } from '../mocks/claims'
import { mockUsers } from '../mocks/users'

const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function listClaims(): Promise<ClaimList> {
  if (USE_MOCKS) { await wait(150); return { items: mockClaims, page: 1, total: mockClaims.length } }
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/claims`); return res.json()
}
export async function getClaim(id: string): Promise<Claim | undefined> {
  if (USE_MOCKS) { await wait(120); return mockClaims.find((c) => c.id === id) }
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/claims/${id}`); return res.json()
}
export async function listUsers(): Promise<User[]> {
  if (USE_MOCKS) { await wait(100); return mockUsers }
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/users`); return res.json()
}
