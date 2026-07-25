import type { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { type ReactElement, StrictMode } from 'react'
import App from '@/App'
import { createQueryClient, QueryProvider } from '@/providers/QueryProvider'

export function renderApp(options?: { strictMode?: boolean }) {
  const app = (
    <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      <App />
    </QueryProvider>
  )
  return render(options?.strictMode ? <StrictMode>{app}</StrictMode> : app)
}

export function renderWithQuery(ui: () => ReactElement, client?: QueryClient) {
  return render(
    <QueryProvider client={client ?? createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      {ui()}
    </QueryProvider>
  )
}
