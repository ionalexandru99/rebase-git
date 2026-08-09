import { useQueries } from '@tanstack/react-query'
import type { RepositoryIdentity } from '@/features/repository-identity'
import { repoQueryKeys, toRepoRef } from '@/features/repository-identity'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { rpcGetCommitStats } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'

export interface CommitStat {
  additions: number
  deletions: number
}

export interface CommitStatsBlock {
  key: readonly string[]
  shas: string[]
}

export const COMMIT_STATS_BLOCK_SIZE = 64

export function commitStatsBlocks(
  shas: readonly string[],
  startIndex: number,
  endIndex: number
): CommitStatsBlock[] {
  const first = Math.max(0, Math.min(startIndex, shas.length))
  const last = Math.max(first, Math.min(endIndex, shas.length))
  if (first === last) {
    return []
  }
  const blocks: CommitStatsBlock[] = []
  const firstBlock = Math.floor(first / COMMIT_STATS_BLOCK_SIZE)
  const lastBlock = Math.floor((last - 1) / COMMIT_STATS_BLOCK_SIZE)
  for (let block = firstBlock; block <= lastBlock; block++) {
    const blockStart = block * COMMIT_STATS_BLOCK_SIZE
    const blockShas = shas.slice(blockStart, blockStart + COMMIT_STATS_BLOCK_SIZE)
    if (blockShas.length === 0) {
      continue
    }
    blocks.push({ key: blockShas, shas: blockShas })
  }
  return blocks
}

const EMPTY_STATS: ReadonlyMap<string, CommitStat> = new Map()

type BlockStats = ReadonlyArray<{ sha: string; additions: number; deletions: number }>

function combineBlocks(results: Array<{ data: BlockStats | undefined }>) {
  const stats = new Map<string, CommitStat>()
  for (const result of results) {
    for (const entry of result.data ?? []) {
      stats.set(entry.sha, { additions: entry.additions, deletions: entry.deletions })
    }
  }
  return stats.size === 0 ? EMPTY_STATS : stats
}

export function useCommitStats(
  repository: RepositoryIdentity | null | undefined,
  shas: readonly string[],
  startIndex: number,
  endIndex: number
): ReadonlyMap<string, CommitStat> {
  const blocks = repository ? commitStatsBlocks(shas, startIndex, endIndex) : []
  return useQueries({
    queries: blocks.map((block) => ({
      queryKey: [
        ...repoQueryKeys(repository, { idle: 'commit-stats' }).root,
        'commit-stats',
        ...block.key
      ],
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: WARM_REOPEN_GC_TIME_MS,
      queryFn: async (): Promise<BlockStats> => {
        if (!repository) {
          return []
        }
        return unwrapOk(await rpcGetCommitStats(toRepoRef(repository).path, block.shas)).stats
      }
    })),
    combine: combineBlocks
  })
}
