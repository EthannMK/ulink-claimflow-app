/**
 * JD1 page memory that survives leaving the page.
 *
 * React forgets a page's state when you navigate away. The JD1 page keeps its working
 * set here instead (uploaded files, the note and your edits, ticket, selected file…),
 * so going to e.g. AI Usage mid-scan and coming back shows everything exactly as it was.
 * It lives in memory only — a full browser refresh starts clean (drafts you saved are
 * still restored from local storage as before).
 */
import { useCallback, useState, type SetStateAction } from 'react'

const store = new Map<string, unknown>()

export function useWorkspaceState<T>(key: string, init: T | (() => T)): [T, (v: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T
    const v = typeof init === 'function' ? (init as () => T)() : init
    store.set(key, v)
    return v
  })
  const set = useCallback((v: SetStateAction<T>) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      store.set(key, next)
      return next
    })
  }, [key])
  return [value, set]
}

export const jd1Workspace = {
  has: (key: string) => store.has(key) && store.get(key) != null,
  clear: () => store.clear(),
}
