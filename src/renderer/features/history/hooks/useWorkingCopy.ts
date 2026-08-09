import { useQuery } from '@tanstack/react-query'
import type { RepositoryIdentity } from '@/features/repository-identity'
import { repoQueryKeys, toRepoRef } from '@/features/repository-identity'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { rpcGetStatus, rpcGetWorkingTreeStats } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'
import type { GitStatus } from '@/types'
import { summarizeWorkingCopy, type WorkingCopyCounts } from '../working-copy-summary'
import type { CommitStat } from './useCommitStats'

export interface WorkingCopyRowData {
  counts: WorkingCopyCounts
  stats: CommitStat | undefined
}

export function useWorkingCopy(
  repository: RepositoryIdentity | null | undefined
): WorkingCopyRowData {
  const keys = repoQueryKeys(repository, { idle: 'working-copy' })
  const enabled = Boolean(repository)

  const statusQuery = useQuery({
    queryKey: keys.status,
    enabled,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async (): Promise<GitStatus> => {
      if (!repository) {
        throw new Error('No repo open')
      }
      return unwrapOk(await rpcGetStatus(toRepoRef(repository).path)).status
    }
  })

  const statsQuery = useQuery({
    queryKey: [...keys.status, 'working-tree-stats'],
    enabled,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async (): Promise<CommitStat> => {
      if (!repository) {
        throw new Error('No repo open')
      }
      const totals = unwrapOk(await rpcGetWorkingTreeStats(toRepoRef(repository).path))
      return { additions: totals.additions, deletions: totals.deletions }
    }
  })

  return { counts: summarizeWorkingCopy(statusQuery.data), stats: statsQuery.data }
}
