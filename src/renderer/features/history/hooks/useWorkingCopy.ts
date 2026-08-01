import { useQuery } from '@tanstack/react-query'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { repoQueryKeys } from '@/lib/query-keys'
import { rpcGetStatus, rpcGetWorkingTreeStats } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'
import type { GitStatus } from '@/types'
import { summarizeWorkingCopy, type WorkingCopyCounts } from '../working-copy-summary'
import type { CommitStat } from './useCommitStats'

export interface WorkingCopyRowData {
  counts: WorkingCopyCounts
  stats: CommitStat | undefined
}

export function useWorkingCopy(repoPath: string | null | undefined): WorkingCopyRowData {
  const keys = repoQueryKeys(repoPath, { idle: 'working-copy' })
  const enabled = Boolean(repoPath)

  const statusQuery = useQuery({
    queryKey: keys.status,
    enabled,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async (): Promise<GitStatus> => {
      if (!repoPath) {
        throw new Error('No repo open')
      }
      return unwrapOk(await rpcGetStatus(repoPath)).status
    }
  })

  const statsQuery = useQuery({
    queryKey: [...keys.status, 'working-tree-stats'],
    enabled,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async (): Promise<CommitStat> => {
      if (!repoPath) {
        throw new Error('No repo open')
      }
      const totals = unwrapOk(await rpcGetWorkingTreeStats(repoPath))
      return { additions: totals.additions, deletions: totals.deletions }
    }
  })

  return { counts: summarizeWorkingCopy(statusQuery.data), stats: statsQuery.data }
}
