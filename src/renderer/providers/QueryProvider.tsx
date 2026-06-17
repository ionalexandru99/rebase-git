import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ParentProps } from '@/lib/react-compat'

// Closed repos keep their cached status/branches/log this long so reopening repaints instantly —
// the role the per-repo snapshot Map used to play before the cache was unified onto Query.
const WARM_REOPEN_GC_TIME_MS = 30 * 60 * 1000

export function createQueryClient(options: { gcTime?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: options.gcTime ?? WARM_REOPEN_GC_TIME_MS,
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
