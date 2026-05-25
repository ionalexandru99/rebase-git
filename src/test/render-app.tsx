import { render } from '@solidjs/testing-library'
import type { JSX } from 'solid-js'
import App from '@/App'
import { createQueryClient, QueryProvider } from '@/providers/QueryProvider'

export function renderApp() {
  return render(() => (
    <QueryProvider client={createQueryClient()}>
      <App />
    </QueryProvider>
  ))
}

export function renderWithQuery(ui: () => JSX.Element) {
  return render(() => <QueryProvider client={createQueryClient()}>{ui()}</QueryProvider>)
}
