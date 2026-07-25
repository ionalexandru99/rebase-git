import { render } from '@testing-library/react'
import { memo, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryPanel } from '@/components/HistoryPanel/HistoryPanel'
import { computeCollapsedView, refFilterKey } from '@/components/HistoryPanel/selectors'
import type { GitLog, GitLogEntry } from '@/types'

const commitRowRender = vi.hoisted(() => vi.fn())

vi.mock('@/components/HistoryPanel/CommitRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/HistoryPanel/CommitRow')>()
  return {
    ...actual,
    CommitRow: memo((props: Parameters<typeof actual.CommitRow>[0]) => {
      commitRowRender(props.commit.hash)
      return <actual.CommitRow {...props} />
    })
  }
})

function entry(hash: string, parents: string[] = [], refs = ''): GitLogEntry {
  return {
    hash,
    message: `message ${hash}`,
    author_name: 'Ann Dev',
    date: '2024-01-02T03:04:05Z',
    parents,
    refs
  }
}

const log: GitLog = {
  all: [
    entry('c1', ['c2'], 'HEAD -> main'),
    entry('c2', ['c3']),
    entry('c3', ['c4']),
    entry('c4', [])
  ],
  loadedCount: 4
}

const VISIBLE_REFS = new Set([refFilterKey('local', 'main')])

// Rerendering the panel with the same data must not re-render a single row: rows are memoised, and
// every prop they take has to be stable for that to hold.
function Harness({ nudge }: { nudge: number }) {
  const [tips] = useState(() => ['c1'])
  const displayed = computeCollapsedView(log.all, tips, new Set())
  const [filteredCommits] = useState(() => log.all.filter((commit) => displayed.has(commit.hash)))
  const [displayedCommitSet] = useState(() => displayed)

  return (
    <>
      <span data-testid="nudge">{nudge}</span>
      <HistoryPanel
        log={log}
        loading={false}
        remoteBranches={[]}
        visibleBranchRefs={VISIBLE_REFS}
        graphCommits={log.all}
        timelineTips={tips}
        filteredCommits={filteredCommits}
        displayedCommitSet={displayedCommitSet}
      />
    </>
  )
}

describe('history rows', () => {
  it('does not re-render rows when the panel re-renders with unchanged data', () => {
    const { rerender } = render(<Harness nudge={0} />)
    expect(commitRowRender).toHaveBeenCalled()

    commitRowRender.mockClear()
    rerender(<Harness nudge={1} />)
    rerender(<Harness nudge={2} />)

    expect(commitRowRender).not.toHaveBeenCalled()
  })
})
