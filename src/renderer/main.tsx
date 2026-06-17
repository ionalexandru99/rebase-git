import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { QueryProvider } from './providers/QueryProvider'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <QueryProvider>
    <App />
  </QueryProvider>
)
