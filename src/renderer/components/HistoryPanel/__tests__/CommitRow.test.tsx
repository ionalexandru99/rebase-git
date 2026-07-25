import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { graphMetricsFor } from '@/lib/git-graph/metrics'
import type { GitLogEntry } from '@/types'
import { CommitRow, commitTopologyLabel } from '../CommitRow'

const METRICS = graphMetricsFor(16)
const REMOTE_NAMES = new Set<string>()
const REMOTES: Record<string, string> = {}

function commit(overrides: Partial<GitLogEntry> = {}): GitLogEntry {
  return {
    hash: 'abcdef1234567890',
    message: 'do the thing',
    author_name: 'Ann Dev',
    date: '2024-01-02T03:04:05Z',
    parents: [],
    refs: '',
    ...overrides
  }
}

function rowProps(overrides: Partial<GitLogEntry> = {}) {
  return {
    commit: commit(overrides),
    lane: 0,
    railLanes: 1,
    metrics: METRICS,
    top: 0,
    dim: false,
    offBranch: false,
    gridTail: '1fr',
    remotes: REMOTES,
    remoteNames: REMOTE_NAMES
  }
}

function renderRow(onCommitAction = vi.fn()) {
  render(<CommitRow {...rowProps()} onCommitAction={onCommitAction} />)
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
      const { unmount } = render(<CommitRow {...rowProps()} onCommitAction={onCommitAction} />)
      fireEvent.contextMenu(screen.getByText('do the thing'))
      fireEvent.click(await screen.findByRole('menuitem', { name: label }))
      expect(onCommitAction).toHaveBeenCalledWith(action, 'abcdef1234567890', 'do the thing')
      unmount()
    }
  })
})

describe('commitTopologyLabel', () => {
  it('describes root, normal, and merge commits', () => {
    expect(commitTopologyLabel(0, false)).toBe('Root commit')
    expect(commitTopologyLabel(1, false)).toBe('Commit')
    expect(commitTopologyLabel(3, false)).toBe('Merge commit with 3 parents')
  })

  it('appends off-branch status', () => {
    expect(commitTopologyLabel(1, true)).toBe('Commit, off the current branch')
  })
})

describe('CommitRow accessibility', () => {
  it('exposes a screen-reader topology hint for a merge commit', () => {
    render(<CommitRow {...rowProps({ parents: ['p1', 'p2'] })} />)
    expect(screen.getByText('Merge commit with 2 parents')).toBeInTheDocument()
  })
})

describe('CommitRow merge expansion control', () => {
  function renderMerge(mergeGlyph: 'collapsed' | 'expanded', onToggleExpand = vi.fn()) {
    render(
      <CommitRow
        {...rowProps({ parents: ['p1', 'p2'] })}
        mergeGlyph={mergeGlyph}
        onToggleExpand={onToggleExpand}
      />
    )
    return onToggleExpand
  }

  it('renders no expansion control for a plain commit', () => {
    render(<CommitRow {...rowProps()} />)
    expect(screen.queryByRole('button', { name: /side branch/i })).not.toBeInTheDocument()
  })

  it('exposes a collapsed control as not expanded and toggles on click', () => {
    const onToggleExpand = renderMerge('collapsed')
    const control = screen.getByRole('button', { name: /side branch/i })
    expect(control).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(control)
    expect(onToggleExpand).toHaveBeenCalledWith('abcdef1234567890')
  })

  it('exposes an expanded control as expanded', () => {
    renderMerge('expanded')
    expect(screen.getByRole('button', { name: /side branch/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
})
