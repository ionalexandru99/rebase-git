import { startRuntimeRenderer } from './bootstrap'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

void startRuntimeRenderer(rootElement)
