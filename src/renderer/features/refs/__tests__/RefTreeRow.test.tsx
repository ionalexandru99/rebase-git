import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refFilterKey } from '@/features/history/selectors'
import type { RefKind, RefLeafRow, RefStashRow } from '@/features/refs/ref-tree'
import { formatCommitAgeShort } from '@/lib/format'
import { RefTreeRow } from '../RefTreeRow'

function leaf(overrides: Partial<RefLeafRow> = {}): RefLeafRow {
  return {
    kind: 'leaf',
    refKind: 'local',
    fullPath: 'main',
    name: 'main',
    depth: 1,
    isCurrent: false,
    ...overrides
  }
}

function renderRow(
  row: RefLeafRow,
  options: {
    onCheckoutLeaf?: (k: RefKind, p: string) => void
    onToggleTimelineVisibility?: (k: RefKind, p: string) => void
    visibleTimelineRefs?: ReadonlySet<string>
  } = {}
) {
  return render(
    <RefTreeRow
      row={row}
      top={0}
      localLoading={false}
      onToggleCollapsed={() => {}}
      onCheckoutLeaf={options.onCheckoutLeaf}
      onToggleTimelineVisibility={options.onToggleTimelineVisibility}
      visibleTimelineRefs={options.visibleTimelineRefs}
    />
  )
}

describe('RefTreeRow leaf', () => {
  it('renders the current pill when isCurrent', () => {
    renderRow(leaf({ isCurrent: true }))
    expect(screen.getByTestId('current-ref-check')).toHaveTextContent('current')
  })

  it('does not render the current pill when not current', () => {
    renderRow(leaf({ isCurrent: false }))
    expect(screen.queryByTestId('current-ref-check')).not.toBeInTheDocument()
  })

  it.each<[RefKind, string]>([
    ['local', 'feature/foo'],
    ['remote', 'origin/feature/bar'],
    ['tag', 'v1.0.0']
  ])('calls onCheckoutLeaf with (%s, %s) on double-click', (refKind, fullPath) => {
    const onCheckoutLeaf = vi.fn()
    renderRow(leaf({ refKind, fullPath, name: fullPath }), { onCheckoutLeaf })
    fireEvent.dblClick(screen.getByRole('button', { name: fullPath }))
    expect(onCheckoutLeaf).toHaveBeenCalledWith(refKind, fullPath)
  })

  it('opens a context menu with Checkout that fires onCheckoutLeaf', async () => {
    const onCheckoutLeaf = vi.fn()
    renderRow(leaf({ refKind: 'remote', fullPath: 'origin/main', name: 'main' }), {
      onCheckoutLeaf
    })
    fireEvent.contextMenu(screen.getByTitle('origin/main'))
    const item = await screen.findByRole('menuitem', { name: 'Checkout' })
    fireEvent.pointerDown(item)
    fireEvent.pointerUp(item)
    fireEvent.click(item)
    expect(onCheckoutLeaf).toHaveBeenCalledWith('remote', 'origin/main')
  })

  it.each<[string, string]>([
    ['Merge into main', 'merge'],
    ['New branch from here', 'new-branch'],
    ['Create tag here', 'create-tag'],
    ['Rename…', 'rename'],
    ['Copy branch name', 'copy-name'],
    ['Delete', 'delete']
  ])('fires onBranchAction %s on a local branch', async (label, action) => {
    const onBranchAction = vi.fn()
    render(
      <RefTreeRow
        row={leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' })}
        top={0}
        localLoading={false}
        currentBranch="main"
        onToggleCollapsed={() => {}}
        onBranchAction={onBranchAction}
      />
    )
    fireEvent.contextMenu(screen.getByTitle('feature'))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    expect(onBranchAction).toHaveBeenCalledWith(action, 'local', 'feature')
  })

  it('disables Delete and Checkout on the current branch', async () => {
    const onBranchAction = vi.fn()
    render(
      <RefTreeRow
        row={leaf({ refKind: 'local', fullPath: 'main', name: 'main', isCurrent: true })}
        top={0}
        localLoading={false}
        currentBranch="main"
        onToggleCollapsed={() => {}}
        onBranchAction={onBranchAction}
      />
    )
    fireEvent.contextMenu(screen.getByTitle('main'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(onBranchAction).not.toHaveBeenCalled()
  })

  it('offers Delete tag on a tag row', async () => {
    const onBranchAction = vi.fn()
    render(
      <RefTreeRow
        row={leaf({ refKind: 'tag', fullPath: 'v1.0', name: 'v1.0' })}
        top={0}
        localLoading={false}
        onToggleCollapsed={() => {}}
        onBranchAction={onBranchAction}
      />
    )
    fireEvent.contextMenu(screen.getByTitle('v1.0'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete tag' }))
    expect(onBranchAction).toHaveBeenCalledWith('delete-tag', 'tag', 'v1.0')
  })

  it('shows ahead/behind badges when tracking data is present', () => {
    renderRow(leaf({ ahead: 2, behind: 1 }))
    const ahead = screen.getByTestId('ref-ahead')
    const behind = screen.getByTestId('ref-behind')
    expect(ahead).toHaveTextContent('2')
    expect(behind).toHaveTextContent('1')
  })

  it('hides the ahead badge when only behind has a count, and vice versa', () => {
    renderRow(leaf({ ahead: 0, behind: 3 }))
    expect(screen.queryByTestId('ref-ahead')).not.toBeInTheDocument()
    expect(screen.getByTestId('ref-behind')).toHaveTextContent('3')
  })

  it('renders no tracking badges when the branch is in sync', () => {
    renderRow(leaf())
    expect(screen.queryByTestId('ref-ahead')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ref-behind')).not.toBeInTheDocument()
  })

  it('shows a timeline visibility toggle for branch rows', () => {
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }))
    expect(screen.getByTestId('timeline-visibility-toggle')).toBeInTheDocument()
  })

  it('does not show a timeline visibility toggle for tags', () => {
    renderRow(leaf({ refKind: 'tag', fullPath: 'v1.0', name: 'v1.0' }))
    expect(screen.queryByTestId('timeline-visibility-toggle')).not.toBeInTheDocument()
  })

  it('calls onToggleTimelineVisibility when the eye is clicked', () => {
    const onToggleTimelineVisibility = vi.fn()
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      onToggleTimelineVisibility
    })
    fireEvent.click(screen.getByTestId('timeline-visibility-toggle'))
    expect(onToggleTimelineVisibility).toHaveBeenCalledWith('local', 'feature')
  })

  it('still calls onCheckoutLeaf on double-click on the branch row', () => {
    const onCheckoutLeaf = vi.fn()
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      onCheckoutLeaf
    })
    fireEvent.dblClick(screen.getByRole('button', { name: 'feature' }))
    expect(onCheckoutLeaf).toHaveBeenCalledWith('local', 'feature')
  })

  it('marks visible timeline refs as pressed on the eye toggle', () => {
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      visibleTimelineRefs: new Set([refFilterKey('local', 'feature')])
    })
    expect(screen.getByTestId('timeline-visibility-toggle')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('RefTreeRow freshness', () => {
  const NOW = Date.parse('2026-08-01T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each<[RefKind, string, string, string]>([
    ['local', 'main', '2026-07-30T12:00:00.000Z', '2d'],
    ['remote', 'origin/main', '2026-07-31T12:00:00.000Z', '1d'],
    [
      'tag',
      'v1.0.0',
      '2026-06-01T12:00:00.000Z',
      formatCommitAgeShort('2026-06-01T12:00:00.000Z', NOW)
    ]
  ])('renders the %s row freshness label', (refKind, fullPath, lastCommitAt, expected) => {
    renderRow(leaf({ refKind, fullPath, name: fullPath, lastCommitAt }))
    expect(screen.getByTestId('ref-freshness').textContent).toBe(expected)
  })

  it('explains the freshness label with a full sentence tooltip', () => {
    renderRow(leaf({ lastCommitAt: '2026-07-30T12:00:00.000Z' }))
    expect(screen.getByTestId('ref-freshness')).toHaveAttribute('title', 'Last commit 2d ago')
  })

  it('renders nothing when a leaf row has no known date', () => {
    renderRow(leaf())
    expect(screen.queryByTestId('ref-freshness')).not.toBeInTheDocument()
  })

  it('renders the stash row freshness label', () => {
    render(
      <RefTreeRow
        row={{
          kind: 'stash',
          refKind: 'stash',
          index: 0,
          ref: 'stash@{0}',
          oid: 'stash-oid-0',
          message: 'WIP: polish palette',
          branch: 'main',
          lastCommitAt: '2026-07-31T12:00:00.000Z'
        }}
        top={0}
        localLoading={false}
        onToggleCollapsed={() => {}}
      />
    )
    expect(screen.getByTestId('ref-freshness').textContent).toBe('1d')
  })

  it('renders nothing when a stash row has no known date', () => {
    render(
      <RefTreeRow
        row={{
          kind: 'stash',
          refKind: 'stash',
          index: 0,
          ref: 'stash@{0}',
          oid: 'stash-oid-0',
          message: 'WIP: polish palette',
          branch: 'main'
        }}
        top={0}
        localLoading={false}
        onToggleCollapsed={() => {}}
      />
    )
    expect(screen.queryByTestId('ref-freshness')).not.toBeInTheDocument()
  })
})

describe('RefTreeRow stash', () => {
  const stash: RefStashRow = {
    kind: 'stash',
    refKind: 'stash',
    index: 1,
    ref: 'stash@{1}',
    oid: 'stash-oid-1',
    message: 'wip on main',
    branch: 'main'
  }

  function renderStash(onStashAction = vi.fn()) {
    render(
      <RefTreeRow
        row={stash}
        top={0}
        localLoading={false}
        onToggleCollapsed={() => {}}
        onStashAction={onStashAction}
      />
    )
    return onStashAction
  }

  it('renders the stash message', () => {
    renderStash()
    expect(screen.getByTestId('ref-tree-stash-row')).toHaveTextContent('wip on main')
  })

  it('applies the stash on double-click', () => {
    const onStashAction = renderStash()
    fireEvent.dblClick(screen.getByText('wip on main'))
    expect(onStashAction).toHaveBeenCalledWith('apply', 1, 'stash-oid-1')
  })

  it.each<[string, string]>([
    ['Apply', 'apply'],
    ['Pop', 'pop'],
    ['Drop', 'drop']
  ])('fires %s from the context menu', async (label, action) => {
    const onStashAction = renderStash()
    fireEvent.contextMenu(screen.getByText('wip on main'))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    expect(onStashAction).toHaveBeenCalledWith(action, 1, 'stash-oid-1')
  })
})
