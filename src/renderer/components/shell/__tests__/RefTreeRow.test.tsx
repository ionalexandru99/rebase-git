import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
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

function renderRow(row: RefLeafRow, onCheckoutLeaf?: (k: RefKind, p: string) => void) {
  return render(() => (
    <RefTreeRow
      row={row}
      top={0}
      loading={false}
      onToggleCollapsed={() => {}}
      onCheckoutLeaf={onCheckoutLeaf}
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
    renderRow(leaf({ refKind, fullPath, name: fullPath }), onCheckoutLeaf)
    fireEvent.dblClick(screen.getByRole('button', { name: fullPath }))
    expect(onCheckoutLeaf).toHaveBeenCalledWith(refKind, fullPath)
  })

  it('opens a context menu with Checkout that fires onCheckoutLeaf', async () => {
    const onCheckoutLeaf = vi.fn()
    renderRow(leaf({ refKind: 'remote', fullPath: 'origin/main', name: 'main' }), onCheckoutLeaf)
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
})
