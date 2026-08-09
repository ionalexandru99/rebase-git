import type { StashEntry } from '@shared/schemas/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { RepositoryIdentity } from '@/features/repository-identity'
import { repoQueryKeys, toRepoRef } from '@/features/repository-identity'
import { rpcStashList } from '@/lib/rpc-client'

const EMPTY_STASHES: StashEntry[] = []

export function useStashes(repository: RepositoryIdentity | null) {
  const queryClient = useQueryClient()
  const queryKeys = repoQueryKeys(repository, { idle: 'stashes' })

  const query = useQuery<StashEntry[]>({
    queryKey: queryKeys.stash,
    enabled: Boolean(repository),
    queryFn: async () => {
      if (!repository) {
        return []
      }
      const response = await rpcStashList(toRepoRef(repository).path)
      return response._tag === 'Ok' ? [...response.stashes] : []
    }
  })

  const refetch = useCallback(() => {
    if (repository) {
      void queryClient.invalidateQueries({ queryKey: repoQueryKeys(repository).stash })
    }
  }, [queryClient, repository])

  const stashes = query.data ?? EMPTY_STASHES
  return useMemo(() => ({ stashes, refetch }), [stashes, refetch])
}
