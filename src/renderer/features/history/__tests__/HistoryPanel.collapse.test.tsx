import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  collectTimelineTips,
  computeCollapsedView,
  refFilterKey
} from '@/features/history/selectors'
import type { GitLog } from '@/types'
import { HistoryPanel } from '..'
import { historyEntry as entry, withQuery } from './history-panel-test-harness'

function CollapsibleHistory({ log }: { log: GitLog }) {
  const [expandedMerges, setExpandedMerges] = useState<ReadonlySet<string>>(new Set())
  const allCommits = log.all
  const visibleBranchRefs = new Set([refFilterKey('local', 'main')])
  const tips = collectTimelineTips(allCommits, visibleBranchRefs, [], new Set())
  const displayed = computeCollapsedView(allCommits, tips, expandedMerges)
  const filteredCommits = allCommits.filter((commit) => displayed.has(commit.hash))
  return (
    <HistoryPanel
      log={log}
      loading={false}
      graphCommits={allCommits}
      timelineTips={tips}
      filteredCommits={filteredCommits}
      displayedCommitSet={displayed}
      expandedMerges={expandedMerges}
      onToggleMergeExpansion={(mergeHash) =>
        setExpandedMerges((previous) => {
          const next = new Set(previous)
          if (next.has(mergeHash)) {
            next.delete(mergeHash)
          } else {
            next.add(mergeHash)
          }
          return next
        })
      }
    />
  )
}

describe('HistoryPanel merge collapse', () => {
  const mergeLog: GitLog = {
    all: [
      entry({ hash: 'm4', message: 'merge tip', refs: 'HEAD -> main', parents: ['m3', 'f2'] }),
      entry({ hash: 'm3', message: 'main-three', refs: '', parents: ['m2'] }),
      entry({ hash: 'f2', message: 'feature-two', refs: '', parents: ['f1'] }),
      entry({ hash: 'f1', message: 'feature-one', refs: '', parents: ['m2'] }),
      entry({ hash: 'm2', message: 'main-two', refs: '', parents: ['m1'] }),
      entry({ hash: 'm1', message: 'main-one', refs: '', parents: [] })
    ],
    loadedCount: 6
  }

  it('hides side-branch commits until the merge dot is expanded, then restores on collapse', () => {
    render(withQuery(<CollapsibleHistory log={mergeLog} />))

    expect(screen.getAllByTestId('commit-row')).toHaveLength(4)
    expect(screen.queryByText('feature-two')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand merge side branch' }))

    expect(screen.getAllByTestId('commit-row')).toHaveLength(6)
    expect(screen.getByText('feature-two')).toBeInTheDocument()
    expect(screen.getByText('feature-one')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse merge side branch' }))

    expect(screen.getAllByTestId('commit-row')).toHaveLength(4)
    expect(screen.queryByText('feature-two')).not.toBeInTheDocument()
  })
})
