import { useEffect, useState } from 'react'

/** State backed by localStorage so a user's own entries survive refresh.
 *  (Per-browser for now; moves to Firestore for shared, multi-user persistence.) */
export function usePersistent<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const full = 'ulink:' + key
  const [val, setVal] = useState<T>(() => {
    try { const raw = localStorage.getItem(full); return raw !== null ? (JSON.parse(raw) as T) : initial }
    catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(full, JSON.stringify(val)) } catch { /* ignore */ } }, [full, val])
  return [val, setVal]
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
