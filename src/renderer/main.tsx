import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { QueryProvider } from './providers/QueryProvider'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

async function start(container: HTMLElement): Promise<void> {
  const playwrightMcpMode = import.meta.env.DEV && import.meta.env.MODE === 'playwright-mcp'
  if (playwrightMcpMode) {
    const { installPlaywrightMcpElectronApi } = await import('./manual-testing/electron-api')
    const searchParams = new URLSearchParams(window.location.search)
    const onboardingComplete = searchParams.get('onboarding') !== '1'
    const historyCount = searchParams.get('pagination') === '1' ? 2_005 : undefined
    const conflicted = searchParams.get('conflict') === '1'
    installPlaywrightMcpElectronApi({ onboardingComplete, historyCount, conflicted })
  }

  const app = (
    <QueryProvider>
      <App />
    </QueryProvider>
  )
  createRoot(container).render(playwrightMcpMode ? app : <StrictMode>{app}</StrictMode>)
}

void start(rootElement)
