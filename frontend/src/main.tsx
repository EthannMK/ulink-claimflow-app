import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient as qc } from './lib/queryClient'
import { router } from './router'
import './index.css'
import { initTheme } from './lib/theme'
import { clearSession } from './lib/auth'

initTheme()

// Show icons only once the icon font is really there (see .material-symbols-outlined in index.css).
// If it never arrives (blocked network), icons stay as blank boxes — the layout never breaks.
;(async () => {
  try {
    const fonts = (document as any).fonts
    if (!fonts?.load) { document.documentElement.classList.add('icons-ready'); return }
    const ok = await Promise.race([
      fonts.load('24px "Material Symbols Outlined"', 'inbox').then((f: unknown[]) => f.length > 0),
      new Promise<boolean>((r) => setTimeout(() => r(false), 15000)),
    ])
    if (ok || fonts.check?.('24px "Material Symbols Outlined"', 'inbox')) document.documentElement.classList.add('icons-ready')
    else fonts.addEventListener?.('loadingdone', () => { if (fonts.check('24px "Material Symbols Outlined"', 'inbox')) document.documentElement.classList.add('icons-ready') })
  } catch { document.documentElement.classList.add('icons-ready') }
})()

// A sign-in token that has expired made every screen show "Not authenticated" while the app
// looked signed in. Any 401 from the API now ends the session and opens the sign-in page.
const _fetch = window.fetch.bind(window)
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const res = await _fetch(...args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0])
    if (res.status === 401 && /\/api\//.test(url) && !/\/auth\/login/.test(url) && location.pathname !== '/login') {
      clearSession()
      location.assign('/login?expired=1&next=' + encodeURIComponent(location.pathname + location.search))
    }
  } catch { /* never break a request */ }
  return res
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
