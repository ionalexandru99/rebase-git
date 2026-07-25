import type { CommitDetail } from '@shared/schemas/git'
import { useQueries, useQuery } from '@tanstack/react-query'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { repoQueryKeys } from '@/lib/query-keys'
import { rpcGetCommitDetail } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'
import { useRepoSession } from '@/stores/repo-session'

// A commit is immutable, so its detail is read once per tab and then served from cache — reselecting
// a commit you already looked at costs nothing.
const commitDetailQuery = (repoPath: string | null, sha: string | null) => ({
  queryKey: repoQueryKeys(repoPath, { idle: 'commit-detail' }).commitDetail(sha ?? 'none'),
  enabled: Boolean(repoPath && sha),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: WARM_REOPEN_GC_TIME_MS,
  queryFn: async (): Promise<CommitDetail> => {
    if (!repoPath || !sha) {
      throw new Error('No commit selected')
    }
    return unwrapOk(await rpcGetCommitDetail(repoPath, sha)).detail
  }
})

export function useCommitDetail(sha: string | null) {
  const { repoPath } = useRepoSession()
  return useQuery(commitDetailQuery(repoPath, sha))
}

export function useCommitDetails(shas: readonly string[]) {
  const { repoPath } = useRepoSession()
  return useQueries({
    queries: shas.map((sha) => commitDetailQuery(repoPath, sha))
  })
}
