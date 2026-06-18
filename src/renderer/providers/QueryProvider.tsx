import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

export function createQueryClient(options: { gcTime?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: options.gcTime,
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false
      }
    }
  })
}

const queryClient = createQueryClient()

export function QueryProvider(props: { children?: ReactNode; client?: QueryClient }) {
  return (
    <QueryClientProvider client={props.client ?? queryClient}>{props.children}</QueryClientProvider>
  )
}

export { queryClient }
