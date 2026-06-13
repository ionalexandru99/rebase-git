import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RowLayout } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'
import { CommitRow } from '../CommitRow'

function row(overrides: Partial<GitLogEntry> = {}): RowLayout {
  return {
    commit: {
      hash: 'abcdef1234567890',
      message: 'do the thing',
      author_name: 'Ann Dev',
      date: '2024-01-02T03:04:05Z',
      parents: [],
      refs: '',
      ...overrides
    },
    commitLane: 0,
    incoming: [],
    outgoing: []
  }
}

function renderRow(onCommitAction = vi.fn()) {
  render(
    <CommitRow
      row={row()}
      top={0}
      dim={false}
      offBranch={false}
      gridTail="1fr"
      remotes={{}}
      remoteNames={new Set()}
      onCommitAction={onCommitAction}
    />
  )
  return onCommitAction
}

describe('CommitRow context menu', () => {
  it('opens a menu on right-click and reverts', async () => {
    const onCommitAction = renderRow()
    fireEvent.contextMenu(screen.getByText('do the thing'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revert commit' }))
    expect(onCommitAction).toHaveBeenCalledWith('revert', 'abcdef1234567890', 'do the thing')
  })

  it('cherry-picks, branches, tags, resets, and copies', async () => {
    const cases: Array<[string, string]> = [
      ['Cherry-pick onto current', 'cherry-pick'],
      ['Create branch here', 'branch-here'],
      ['Create tag here', 'tag-here'],
      ['Reset branch here (soft)', 'reset-soft'],
      ['Reset branch here (hard)', 'reset-hard'],
      ['Copy SHA', 'copy-sha'],
      ['Copy message', 'copy-message']
    ]
    for (const [label, action] of cases) {
      const onCommitAction = vi.fn()
      const { unmount } = render(
        <CommitRow
          row={row()}
          top={0}
          dim={false}
          offBranch={false}
          gridTail="1fr"
          remotes={{}}
          remoteNames={new Set()}
          onCommitAction={onCommitAction}
        />
      )
      fireEvent.contextMenu(screen.getByText('do the thing'))
      fireEvent.click(await screen.findByRole('menuitem', { name: label }))
      expect(onCommitAction).toHaveBeenCalledWith(action, 'abcdef1234567890', 'do the thing')
      unmount()
    }
  })
})
