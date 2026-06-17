import { type StashEntry, StashListResponseSchema } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sidecarFetch } from '@/lib/sidecar-fetch'

export const stashKey = (repoPath: string) => ['stashes', repoPath] as const

export function useStashes(repoPath: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery<StashEntry[]>({
    queryKey: repoPath ? stashKey(repoPath) : ['stashes', 'idle'],
    enabled: Boolean(repoPath),
    queryFn: async () => {
      if (!repoPath) {
        return []
      }
      const response = await sidecarFetch(
        SidecarOp.stashList,
        { repoPath },
        StashListResponseSchema
      )
      return response._tag === 'Ok' ? response.stashes : []
    }
  })

  const refetch = () => {
    if (repoPath) {
      void queryClient.invalidateQueries({ queryKey: stashKey(repoPath) })
    }
  }

  return {
    stashes: () => query.data ?? [],
    refetch
  }
}
