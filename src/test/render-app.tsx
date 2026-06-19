import type { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import App from '@/App'
import { createQueryClient, QueryProvider } from '@/providers/QueryProvider'

export function renderApp() {
  return render(
    <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      <App />
    </QueryProvider>
  )
}

export function renderWithQuery(ui: () => ReactElement, client?: QueryClient) {
  return render(
    <QueryProvider client={client ?? createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      {ui()}
    </QueryProvider>
  )
}
