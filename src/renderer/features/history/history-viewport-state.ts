import { HISTORY_LOAD_MORE_THRESHOLD_ROWS } from '@/lib/virtual-config'

interface HistoryScrollMemory {
  get(repoPath: string): number
  remember(repoPath: string, scrollTop: number): void
}

export function createHistoryScrollMemory(limit = 32): HistoryScrollMemory {
  const positions = new Map<string, number>()

  return {
    get(repoPath) {
      return positions.get(repoPath) ?? 0
    },
    remember(repoPath, scrollTop) {
      positions.delete(repoPath)
      positions.set(repoPath, scrollTop)
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
  const key = `${input.repoPath ?? ''}:${input.loadedCount}`
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
