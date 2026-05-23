import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RefTreeRow } from '@/components/shell/RefTreeRow'
import type { RefKind, RefLeafRow } from '@/lib/ref-tree'

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
  return render(
    <RefTreeRow
      row={row}
      top={0}
      loading={false}
      onToggleCollapsed={() => {}}
      onCheckoutLeaf={onCheckoutLeaf}
    />
  )
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
    fireEvent.doubleClick(screen.getByRole('button', { name: fullPath }))
    expect(onCheckoutLeaf).toHaveBeenCalledWith(refKind, fullPath)
  })

  it('opens a context menu with Checkout that fires onCheckoutLeaf', () => {
    const onCheckoutLeaf = vi.fn()
    renderRow(leaf({ refKind: 'remote', fullPath: 'origin/main', name: 'main' }), onCheckoutLeaf)
    fireEvent.contextMenu(screen.getByTitle('origin/main'))
    fireEvent.click(screen.getByText('Checkout'))
    expect(onCheckoutLeaf).toHaveBeenCalledWith('remote', 'origin/main')
  })
})
