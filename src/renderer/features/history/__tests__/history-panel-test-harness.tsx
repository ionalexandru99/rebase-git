import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { createQueryClient, QueryProvider } from '@/app/QueryProvider'
import { computeBranchFilterSet, refFilterKey } from '@/features/history/selectors'
import type { GitLog, GitLogEntry } from '@/types'
import { HistoryPanel } from '..'
import { createHistoryEntryBuilder } from './fixtures'

const canvasRender = vi.hoisted(() => vi.fn())

vi.mock('@/features/history/CommitGraphCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/history/CommitGraphCanvas')>()
  return {
    CommitGraphCanvas: (props: Parameters<typeof actual.CommitGraphCanvas>[0]) => {
      canvasRender(props)
      return actual.CommitGraphCanvas(props)
    }
  }
})

export function lastCanvasProps() {
  return canvasRender.mock.lastCall?.[0] as {
    metrics: { rowHeight: number }
    paddingStart?: number
    headRow?: number
  }
}

export interface PanelOptions {
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  visibleBranchRefs?: ReadonlySet<string>
  remoteBranches?: string[]
  repoPath?: string
  currentBranch?: string
  onSelectWorkingCopy?: () => void
  workingCopySelected?: boolean
}

export function filterCommits(
  log: GitLog | null,
  visibleBranchRefs: ReadonlySet<string>,
  remoteBranches: string[]
): GitLogEntry[] {
  const commits = log?.all ?? []
  if (visibleBranchRefs.size === 0) {
    return []
  }
  const reachable = computeBranchFilterSet(commits, visibleBranchRefs, remoteBranches, new Set())
  if (!reachable) {
    return []
  }
  return commits.filter((commit) => reachable.has(commit.hash))
}

export function withQuery(ui: ReactElement) {
  return (
    <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      {ui}
    </QueryProvider>
  )
}

export function renderPanel(log: GitLog | null, options: PanelOptions = {}) {
  const visibleBranchRefs =
    options.visibleBranchRefs ??
    new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])
  const remoteBranches = options.remoteBranches ?? ['origin/main']

  return render(
    withQuery(
      <HistoryPanel
        log={log}
        loading={options.loading ?? false}
        hasMore={options.hasMore}
        onLoadMore={options.onLoadMore}
        filteredCommits={filterCommits(log, visibleBranchRefs, remoteBranches)}
        repoPath={options.repoPath}
        currentBranch={options.currentBranch}
        onSelectWorkingCopy={options.onSelectWorkingCopy}
        workingCopySelected={options.workingCopySelected}
      />
    )
  )
}

export const historyEntry = createHistoryEntryBuilder({
  message: 'msg',
  author_name: 'Jane Doe',
  date: new Date().toISOString(),
  refs: 'main'
})
