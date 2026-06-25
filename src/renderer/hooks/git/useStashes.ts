import type { StashEntry } from '@shared/schemas/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { repoQueryKeys } from '@/lib/query-keys'
import { rpcStashList } from '@/lib/rpc-client'

export function useStashes(repoPath: string | null) {
  const queryClient = useQueryClient()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'stashes' })

  const query = useQuery<StashEntry[]>({
    queryKey: queryKeys.stash,
    enabled: Boolean(repoPath),
    queryFn: async () => {
      if (!repoPath) {
        return []
      }
      const response = await rpcStashList(repoPath)
      return response._tag === 'Ok' ? [...response.stashes] : []
    }
  })

  const refetch = () => {
    if (repoPath) {
      void queryClient.invalidateQueries({ queryKey: repoQueryKeys(repoPath).stash })
    }
  }

  return {
    stashes: query.data ?? [],
    refetch
  }
}
