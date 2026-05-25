import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import type { RefKind, RefLeafRow } from '@/lib/ref-tree'
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
    onToggleFilterRef?: (k: RefKind, p: string) => void
    filterActive?: boolean
    selectedFilterRefs?: ReadonlySet<string>
  } = {}
) {
  return render(() => (
    <RefTreeRow
      row={row}
      top={0}
      loading={false}
      onToggleCollapsed={() => {}}
      onCheckoutLeaf={options.onCheckoutLeaf}
      onToggleFilterRef={options.onToggleFilterRef}
      filterActive={options.filterActive}
      selectedFilterRefs={options.selectedFilterRefs}
    />
  ))
}

describe('RefTreeRow leaf', () => {
  it('renders the left accent bar and Check icon when isCurrent', () => {
    renderRow(leaf({ isCurrent: true }))
    expect(screen.getByTestId('current-ref-bar')).toBeInTheDocument()
    expect(screen.getByTestId('current-ref-check')).toBeInTheDocument()
  })

  it('does not render the indicators when not current', () => {
    renderRow(leaf({ isCurrent: false }))
    expect(screen.queryByTestId('current-ref-bar')).not.toBeInTheDocument()
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
    renderRow(leaf({ refKind: 'remote', fullPath: 'origin/main', name: 'main' }), { onCheckoutLeaf })
    fireEvent.contextMenu(screen.getByTitle('origin/main'))
    const item = await screen.findByRole('menuitem', { name: 'Checkout' })
    fireEvent.pointerDown(item)
    fireEvent.pointerUp(item)
    fireEvent.click(item)
    expect(onCheckoutLeaf).toHaveBeenCalledWith('remote', 'origin/main')
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

  it('shows a filter checkbox for branch rows when filter mode is active', () => {
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      filterActive: true
    })
    expect(screen.getByTestId('ref-filter-checkbox')).toBeInTheDocument()
  })

  it('does not show a filter checkbox for tags when filter mode is active', () => {
    renderRow(leaf({ refKind: 'tag', fullPath: 'v1.0', name: 'v1.0' }), { filterActive: true })
    expect(screen.queryByTestId('ref-filter-checkbox')).not.toBeInTheDocument()
  })

  it('calls onToggleFilterRef on click when filter mode is active', () => {
    const onToggleFilterRef = vi.fn()
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      filterActive: true,
      onToggleFilterRef
    })
    fireEvent.click(screen.getByRole('button', { name: 'feature' }))
    expect(onToggleFilterRef).toHaveBeenCalledWith('local', 'feature')
  })

  it('still calls onCheckoutLeaf on double-click when filter mode is active', () => {
    const onCheckoutLeaf = vi.fn()
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      filterActive: true,
      onCheckoutLeaf
    })
    fireEvent.dblClick(screen.getByRole('button', { name: 'feature' }))
    expect(onCheckoutLeaf).toHaveBeenCalledWith('local', 'feature')
  })

  it('marks selected filter refs as pressed', () => {
    renderRow(leaf({ refKind: 'local', fullPath: 'feature', name: 'feature' }), {
      filterActive: true,
      selectedFilterRefs: new Set([refFilterKey('local', 'feature')])
    })
    expect(screen.getByRole('button', { name: 'feature' })).toHaveAttribute('aria-pressed', 'true')
  })
})
