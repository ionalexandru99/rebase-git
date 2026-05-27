import { render } from '@testing-library/react'
import App from '@/App'
import type { JSX } from '@/lib/react-compat'
import { createQueryClient, QueryProvider } from '@/providers/QueryProvider'

export function renderApp() {
  return render(
    <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      <App />
    </QueryProvider>
  )
}

export function renderWithQuery(ui: () => JSX.Element) {
  return render(
    <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      {ui()}
    </QueryProvider>
  )
}
