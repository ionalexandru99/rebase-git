import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { QueryProvider } from './app/QueryProvider'
import { DiffWorkerPoolProvider } from './features/diff/DiffWorkerPool'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

async function start(container: HTMLElement): Promise<void> {
  const playwrightMcpMode = import.meta.env.DEV && import.meta.env.MODE === 'playwright-mcp'
  if (playwrightMcpMode) {
    const { installPlaywrightMcpElectronApiFromSearch } = await import(
      './manual-testing/install-from-url'
    )
    installPlaywrightMcpElectronApiFromSearch(window.location.search)
  }

  const app = (
    <ErrorBoundary scope="app">
      <QueryProvider>
        <DiffWorkerPoolProvider>
          <App />
        </DiffWorkerPoolProvider>
      </QueryProvider>
    </ErrorBoundary>
  )
  createRoot(container).render(playwrightMcpMode ? app : <StrictMode>{app}</StrictMode>)
}

void start(rootElement)
