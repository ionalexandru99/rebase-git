import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UnifiedFileRow } from '@/features/status/status-file-rows'
import { type FileListSection, VirtualFileList } from '../VirtualFileList'

const unstagedRow: UnifiedFileRow = {
  file: 'a.ts',
  fileKind: 'modified',
  stageState: 'unstaged',
  isConflicted: false,
  isUntracked: false,
  source: 'worktree'
}

const stagedRow: UnifiedFileRow = {
  file: 'b.ts',
  fileKind: 'modified',
  stageState: 'staged',
  isConflicted: false,
  isUntracked: false,
  source: 'worktree'
}

const amendRow: UnifiedFileRow = {
  file: 'c.ts',
  fileKind: 'modified',
  stageState: 'staged',
  isConflicted: false,
  isUntracked: false,
  source: 'head-commit',
  dropState: 'kept'
}

const sections: FileListSection[] = [
  { key: 'staged', label: 'Staged', rows: [stagedRow] },
  { key: 'unstaged', label: 'Unstaged', rows: [unstagedRow] }
]

function renderList(overrides: Partial<Parameters<typeof VirtualFileList>[0]> = {}) {
  return render(
    <VirtualFileList
      sections={sections}
      selected={null}
      onSelect={vi.fn()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      onToggleDrop={vi.fn()}
      {...overrides}
    />
  )
}

describe('VirtualFileList — groups', () => {
  it('renders a heading with a row count for each group', () => {
    renderList()

    const staged = screen.getByRole('heading', { name: 'Staged' })
    const unstaged = screen.getByRole('heading', { name: 'Unstaged' })
    expect(staged.closest('li')).toHaveTextContent('1')
    expect(unstaged.closest('li')).toHaveTextContent('1')
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('b.ts')).toBeInTheDocument()
  })

  it('renders the groups in the order it is given them', () => {
    renderList()

    const staged = screen.getByRole('heading', { name: 'Staged' })
    const unstaged = screen.getByRole('heading', { name: 'Unstaged' })
    expect(staged.compareDocumentPosition(unstaged) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('tags each row with the group it renders in', () => {
    renderList()

    const rows = screen.getAllByTestId('status-file-row')
    expect(rows.map((row) => row.getAttribute('data-group'))).toEqual(['staged', 'unstaged'])
  })

  it('runs a group-level action from its heading', () => {
    const onAction = vi.fn()
    renderList({
      sections: [
        {
          key: 'unstaged',
          label: 'Unstaged',
          rows: [unstagedRow],
          action: { label: 'Stage all', onAction }
        }
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('routes selection with the row group', () => {
    const onSelect = vi.fn()
    renderList({ onSelect })

    fireEvent.click(screen.getByText('b.ts'))
    expect(onSelect).toHaveBeenCalledWith('b.ts', 'staged')

    fireEvent.click(screen.getByText('a.ts'))
    expect(onSelect).toHaveBeenCalledWith('a.ts', 'unstaged')
  })

  it('stages and unstages through the row buttons of each group', () => {
    const onStage = vi.fn()
    const onUnstage = vi.fn()
    renderList({ onStage, onUnstage })

    fireEvent.click(screen.getByRole('button', { name: 'Stage a.ts' }))
    expect(onStage).toHaveBeenCalledWith('a.ts')

    fireEvent.click(screen.getByRole('button', { name: 'Unstage b.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('b.ts')
  })

  // A partially-staged file is listed twice; highlighting both rows would hide which side the diff
  // pane is showing.
  it('highlights only the row in the selected group when a file is listed twice', () => {
    const partial: UnifiedFileRow = { ...unstagedRow, stageState: 'partial' }
    renderList({
      sections: [
        { key: 'staged', label: 'Staged', rows: [partial] },
        { key: 'unstaged', label: 'Unstaged', rows: [partial] }
      ],
      selected: { file: 'a.ts', group: 'unstaged' }
    })

    const rows = screen.getAllByTestId('status-file-row')
    expect(rows[0]?.className).not.toMatch(/brand-soft/)
    expect(rows[1]?.className).toMatch(/brand-soft/)
  })

  it('renders the amend group with drop checkboxes and reports a drop on toggle', () => {
    const onToggleDrop = vi.fn()
    renderList({
      sections: [{ key: 'head-commit', label: 'Last commit', rows: [amendRow] }],
      onToggleDrop
    })

    expect(screen.getByRole('heading', { name: 'Last commit' })).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: /drop c\.ts from last commit/i })
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(onToggleDrop).toHaveBeenCalledWith('c.ts')
  })

  it('highlights an amend row only for a head-commit selection', () => {
    renderList({
      sections: [
        { key: 'staged', label: 'Staged', rows: [{ ...stagedRow, file: 'c.ts' }] },
        { key: 'head-commit', label: 'Last commit', rows: [amendRow] }
      ],
      selected: { file: 'c.ts', source: 'head-commit' }
    })

    const rows = screen.getAllByTestId('status-file-row')
    expect(rows[0]?.className).not.toMatch(/brand-soft/)
    expect(rows[1]?.className).toMatch(/brand-soft/)
  })
})
