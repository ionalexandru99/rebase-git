import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { ParentProps } from 'solid-js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false
    }
  }
})

export function QueryProvider(props: ParentProps) {
  return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
}

export { queryClient }
