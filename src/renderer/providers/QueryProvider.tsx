import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { ParentProps } from 'solid-js'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false
      }
    }
  })
}

const queryClient = createQueryClient()

export function QueryProvider(props: ParentProps & { client?: QueryClient }) {
  return (
    <QueryClientProvider client={props.client ?? queryClient}>{props.children}</QueryClientProvider>
  )
}

export { queryClient }
