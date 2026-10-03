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
