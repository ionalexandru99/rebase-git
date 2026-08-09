import type { RepoRef } from '@common/features/repository-identity'
import { repositoryIdentityKey } from '@/features/repository-identity'
import { HISTORY_LOAD_MORE_THRESHOLD_ROWS } from '@/lib/virtual-config'

interface HistoryScrollMemory {
  get(repository: RepoRef | string): number
  remember(repository: RepoRef | string, scrollTop: number): void
}

export function createHistoryScrollMemory(limit = 32): HistoryScrollMemory {
  const positions = new Map<string, number>()

  return {
    get(repository) {
      return positions.get(repositoryIdentityKey(repository)) ?? 0
    },
    remember(repository, scrollTop) {
      const key = repositoryIdentityKey(repository)
      positions.delete(key)
      positions.set(key, scrollTop)
      while (positions.size > limit) {
        const oldestRepoPath = positions.keys().next().value
        if (oldestRepoPath === undefined) {
          break
        }
        positions.delete(oldestRepoPath)
      }
    }
  }
}

interface HistoryAutoLoadInput {
  endIndex: number
  commitCount: number
  hasMore?: boolean
  loading: boolean
  loadingMore?: boolean
  canLoadMore: boolean
  repository?: RepoRef | string | null
  repoPath?: string | null
  loadedCount: number
}

export function nextHistoryAutoLoadKey(
  input: HistoryAutoLoadInput,
  previousKey: string | null
): string | null {
  const nearEnd = input.endIndex >= input.commitCount - HISTORY_LOAD_MORE_THRESHOLD_ROWS
  if (!nearEnd || !input.hasMore || input.loading || input.loadingMore || !input.canLoadMore) {
    return null
  }
  const repository = input.repository ?? input.repoPath
  const key = `${repository ? repositoryIdentityKey(repository) : ''}:${input.loadedCount}`
  return key === previousKey ? null : key
}

export function canRestoreHistoryScroll(
  scrollTop: number,
  totalHeight: number,
  viewportHeight: number
): boolean {
  return scrollTop === 0 || totalHeight - viewportHeight >= scrollTop
}

export const historyScrollMemory = createHistoryScrollMemory()
