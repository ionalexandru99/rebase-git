import { render } from 'solid-js/web'
import './index.css'
import App from './App'
import { QueryProvider } from './providers/QueryProvider'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

render(
  () => (
    <QueryProvider>
      <App />
    </QueryProvider>
  ),
  rootElement
)
