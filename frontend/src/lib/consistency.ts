/** "Use the clearest value across pages" — when a name / NRC / date of birth / policy number is
 *  read differently on different pages (usually messy handwriting), find the variants, suggest the
 *  most reliable one (printed > handwritten, clear > unclear, most pages), and let the officer apply
 *  it. Nothing changes automatically, and the AI's original reading is kept on each changed field. */
import type { PageDetail } from './review'

export type ConsistencyField = 'name' | 'nrc' | 'dob' | 'policy'
export const FIELD_LABELS: Record<ConsistencyField, string> = {
  name: 'Names (patient / member)', nrc: 'NRC / passport number', dob: 'Date of birth', policy: 'Policy / member number',
}

interface Group { key: string; field: ConsistencyField; title: string; test: (label: string) => boolean }
const NOT_PERSON = /(hospital|clinic|doctor|\bdr\b|physician|provider|company|employer|insurer|insurance|bank|account|payee|pharmacy|staff|agent|father|mother|spouse|husband|wife|relation|nominee|beneficiar|signator|officer|witness|product|plan|drug|medicine|file|user|branch|approv|check|verif|prepared|received|cashier)/i
const isName = (l: string) => /\bname\b|အမည်/i.test(l) && !NOT_PERSON.test(l)
const GROUPS: Group[] = [
  { key: 'member', field: 'name', title: 'Member / insured name', test: (l) => isName(l) && /(member|insured|employee|holder|claimant|staff)/i.test(l) },
  { key: 'patient', field: 'name', title: 'Patient name', test: (l) => isName(l) && !/(member|insured|employee|holder|claimant|staff)/i.test(l) },
  { key: 'nrc', field: 'nrc', title: 'NRC / passport number', test: (l) => /(\bnrc\b|n\.r\.c|passport|national\s*reg|မှတ်ပုံတင်)/i.test(l) && !/(invoice|receipt|policy|claim|slip|tax)/i.test(l) },
  { key: 'dob', field: 'dob', title: 'Date of birth', test: (l) => /(date\s*of\s*birth|\bdob\b|d\.o\.b|birth\s*date|မွေးသက္ကရာဇ်)/i.test(l) },
  { key: 'policy', field: 'policy', title: 'Policy / member number', test: (l) => /(policy\s*(no|number|#)|policy$|certificate\s*no|member\s*(id|no|number)|card\s*no)/i.test(l) },
]

const HONORIFIC = /^(u|daw|mg|maung|ma|ko|mr|mrs|ms|miss|dr|sayar|saya)\.?\s+/i
// Burmese honorifics: U, Daw, Maung, Ko, Ma (written before the name)
const HONORIFIC_MY = /^(ဦး|ဒေါ်|မောင်|ကို|မ)\s*/
/** Company / organisation names are not a person's name (e.g. a group policy's "insured" = the employer). */
const ORG = /\b(international|ltd|limited|co\.?|company|corp|corporation|inc|organi[sz]ation|foundation|association|bank|hospital|clinic|group|services?|insurance|ngo|unicef|undp|care)\b|ကုမ္ပဏီ|လီမိတက်/i
export const isOrgName = (v: string) => ORG.test(v || '')
/** 'my' = Burmese letters, 'latin' = A–Z, '' = neither. A Burmese and an English spelling of the same name
 *  share no letters, so letter-similarity can't compare them — the officer decides. */
export function scriptOf(v: string): 'my' | 'latin' | '' {
  if (/[\u1000-\u109f]/.test(v || '')) return 'my'
  return /[a-z]/i.test(v || '') ? 'latin' : ''
}
export function normalize(field: ConsistencyField, v: string): string {
  let s = (v || '').trim().toLowerCase()
  if (field === 'name') {
    for (let i = 0; i < 3; i++) s = s.replace(HONORIFIC, '').replace(HONORIFIC_MY, '')
    return s.replace(/[^a-zက-႟]/g, '')
  }
  if (field === 'dob') return s.split(/[^0-9a-z]+/).filter(Boolean).map((x) => x.replace(/^0+(?=\d)/, '')).join('-')
  return s.replace(/[^a-z0-9က-႟/]/g, '')
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}
/** 0..1 — how alike two normalized values are. Below 0.5 = probably a different person / number. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  return 1 - distance(a, b) / Math.max(a.length, b.length)
}

export interface Variant { value: string; norm: string; pages: number[]; printed: number; clear: number; count: number; hw: boolean; unclear: boolean }
export interface Conflict { key: string; field: ConsistencyField; title: string; variants: Variant[]; best: number; id: string }

export function findConflicts(pages: PageDetail[], fields: ConsistencyField[]): Conflict[] {
  const out: Conflict[] = []
  for (const g of GROUPS) {
    if (!fields.includes(g.field)) continue
    const byNorm = new Map<string, Variant>()
    for (const p of pages) for (const it of p.items) {
      if (!g.test(it.label) || !it.value.trim()) continue
      if (g.field === 'name' && isOrgName(it.value)) continue   // employer / company, not a person
      const norm = normalize(g.field, it.value)
      if (norm.length < 2) continue
      const v = byNorm.get(norm) ?? { value: it.value.trim(), norm, pages: [], printed: 0, clear: 0, count: 0, hw: false, unclear: false }
      v.count++; if (!v.pages.includes(p.page)) v.pages.push(p.page)
      if (!it.hw) { v.printed++; v.value = it.value.trim() } else v.hw = true   // prefer the printed spelling
      if (!it.unclear) v.clear++; else v.unclear = true
      byNorm.set(norm, v)
    }
    const variants = [...byNorm.values()]
    if (variants.length < 2) continue
    const score = (v: Variant) => v.printed * 3 + v.clear * 2 + v.count
    variants.sort((a, b) => score(b) - score(a))
    out.push({ key: g.key, field: g.field, title: g.title, variants, best: 0, id: `${g.key}:${variants.map((v) => v.norm).sort().join('|')}` })
  }
  return out
}

/** Which variants "Use … everywhere" changes by default: every variant, except one written in the
 *  SAME script that is clearly different (probably another person/number). A Burmese spelling of an
 *  English name (and vice versa) is included — letters can't be compared across scripts. */
export function defaultInclude(c: Conflict, bestIdx = c.best): Set<string> {
  const best = c.variants[bestIdx]
  return new Set(c.variants.filter((v, i) => i !== bestIdx &&
    !(scriptOf(v.value) === scriptOf(best.value) && similarity(v.norm, best.norm) < 0.5)).map((v) => v.norm))
}

/** Put `value` into every field of this group whose reading is in `include` (normalized values).
 *  Each changed field keeps the AI's reading (ai_value) so it can be restored. */
export function applyValue(pages: PageDetail[], c: Conflict, value: string, include?: Set<string>): PageDetail[] {
  const g = GROUPS.find((x) => x.key === c.key)!
  const target = normalize(c.field, value)
  const inc = include ?? defaultInclude(c, Math.max(0, c.variants.findIndex((v) => v.norm === target)))
  return pages.map((p) => ({
    ...p,
    items: p.items.map((it) => {
      if (!g.test(it.label) || !it.value.trim()) return it
      if (g.field === 'name' && isOrgName(it.value)) return it
      const n = normalize(c.field, it.value)
      if (n === target || !inc.has(n)) return it
      return { ...it, value, ai_value: it.ai_value || it.value }
    }),
  }))
}
