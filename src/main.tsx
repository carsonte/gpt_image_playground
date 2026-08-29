import 'core-js/actual/array/at'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { applyTheme, getTheme } from './lib/theme'
import { installMobileViewportGuards } from './lib/viewport'

const App = lazy(() => import('./App'))
const AdminApp = lazy(() => import('./admin/AdminApp'))

applyTheme(getTheme())
installMobileViewportGuards()

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-slate-950" aria-busy="true" />}>
      {window.location.pathname.startsWith('/admin') ? <AdminApp /> : <App />}
    </Suspense>
  </StrictMode>,
)
