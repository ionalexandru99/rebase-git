import type { StashEntry } from '@shared/schemas/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { repoQueryKeys } from '@/features/repository-identity'
import { rpcStashList } from '@/lib/rpc-client'

const EMPTY_STASHES: StashEntry[] = []

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

  const refetch = useCallback(() => {
    if (repoPath) {
      void queryClient.invalidateQueries({ queryKey: repoQueryKeys(repoPath).stash })
    }
  }, [queryClient, repoPath])

  const stashes = query.data ?? EMPTY_STASHES
  return useMemo(() => ({ stashes, refetch }), [stashes, refetch])
}
