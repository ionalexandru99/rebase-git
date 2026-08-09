import type { RepoRef } from '@common/features/repository-identity'
import type { CommitDetail } from '@shared/schemas/git'
import { useQueries, useQuery } from '@tanstack/react-query'
import { repoQueryKeys } from '@/features/repository-identity'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { rpcGetCommitDetail } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'
import { useRepoSession } from '@/stores/repo-session'

const commitDetailQuery = (repository: RepoRef | null, sha: string | null) => ({
  queryKey: repoQueryKeys(repository, { idle: 'commit-detail' }).commitDetail(sha ?? 'none'),
  enabled: Boolean(repository && sha),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: WARM_REOPEN_GC_TIME_MS,
  queryFn: async (): Promise<CommitDetail> => {
    if (!repository || !sha) {
      throw new Error('No commit selected')
    }
    return unwrapOk(await rpcGetCommitDetail(repository.path, sha)).detail
  }
})

export function useCommitDetail(sha: string | null) {
  const { repoRef } = useRepoSession()
  return useQuery(commitDetailQuery(repoRef, sha))
}

export function useCommitDetails(shas: readonly string[]) {
  const { repoRef } = useRepoSession()
  return useQueries({
    queries: shas.map((sha) => commitDetailQuery(repoRef, sha))
  })
}
