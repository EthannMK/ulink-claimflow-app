/** Light / dark / follow-the-computer appearance, remembered per browser. */
export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'cf-theme'
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function getTheme(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' }
}
function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && !!mq?.matches)
  document.documentElement.classList.toggle('dark', dark)
}
export function setTheme(choice: ThemeChoice) {
  try { if (choice === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice) } catch { /* private mode */ }
  apply(choice)
  window.dispatchEvent(new Event('cf-theme'))
}
/** Call once at start-up (before the first render) so the page never flashes the wrong theme. */
export function initTheme() {
  apply(getTheme())
  mq?.addEventListener?.('change', () => { if (getTheme() === 'system') apply('system') })
}
