import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UnifiedFileRow } from '@/features/status/status-file-rows'
import { type FileListInput, VirtualFileList } from '../VirtualFileList'

const worktreeRow: UnifiedFileRow = {
  file: 'a.ts',
  fileKind: 'modified',
  stageState: 'unstaged',
  isConflicted: false,
  isUntracked: false,
  source: 'worktree'
}

const amendRow: UnifiedFileRow = {
  file: 'b.ts',
  fileKind: 'modified',
  stageState: 'staged',
  isConflicted: false,
  isUntracked: false,
  source: 'head-commit',
  dropState: 'kept'
}

const flatInput: FileListInput = { kind: 'flat', rows: [worktreeRow, amendRow] }

const sectionsInput: FileListInput = {
  kind: 'sections',
  sections: [
    { label: 'Working tree', rows: [worktreeRow] },
    { label: 'Last commit', rows: [amendRow] }
  ]
}

describe('VirtualFileList — unified worktree + amend rows', () => {
  it('renders both a stageable worktree row and a droppable amend row in one list', () => {
    render(
      <VirtualFileList
        input={flatInput}
        selected={null}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    expect(screen.getByRole('checkbox', { name: /stage a\.ts/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /drop b\.ts from last commit/i })).toBeChecked()
  })

  it('reports a drop when the amend row checkbox is toggled', () => {
    const onToggleDrop = vi.fn()
    render(
      <VirtualFileList
        input={flatInput}
        selected={null}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={onToggleDrop}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /drop b\.ts from last commit/i }))
    expect(onToggleDrop).toHaveBeenCalledWith('b.ts')
  })

  it('routes selection with the row source', () => {
    const onSelect = vi.fn()
    render(
      <VirtualFileList
        input={flatInput}
        selected={null}
        onSelect={onSelect}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('b.ts'))
    expect(onSelect).toHaveBeenCalledWith('b.ts', 'head-commit')

    fireEvent.click(screen.getByText('a.ts'))
    expect(onSelect).toHaveBeenCalledWith('a.ts', 'worktree')
  })

  it('tags an amend row with its source only in a flat list', () => {
    const { rerender } = render(
      <VirtualFileList
        input={flatInput}
        selected={null}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    expect(screen.getByText('Last commit')).toBeInTheDocument()

    rerender(
      <VirtualFileList
        input={sectionsInput}
        selected={null}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    expect(screen.getAllByText('Last commit')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Last commit' })).toBeInTheDocument()
  })
})

describe('VirtualFileList — sections', () => {
  it('renders a heading with a row count for each section', () => {
    render(
      <VirtualFileList
        input={sectionsInput}
        selected={null}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    const workingTreeHeading = screen.getByRole('heading', { name: 'Working tree' })
    const lastCommitHeading = screen.getByRole('heading', { name: 'Last commit' })
    expect(workingTreeHeading).toBeInTheDocument()
    expect(lastCommitHeading).toBeInTheDocument()
    expect(workingTreeHeading.closest('li')).toHaveTextContent('1')
    expect(lastCommitHeading.closest('li')).toHaveTextContent('1')
    expect(screen.getAllByRole('heading')).toHaveLength(2)
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('b.ts')).toBeInTheDocument()
  })

  it('selects a file inside a section with its source', () => {
    const onSelect = vi.fn()
    render(
      <VirtualFileList
        input={sectionsInput}
        selected={null}
        onSelect={onSelect}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('b.ts'))
    expect(onSelect).toHaveBeenCalledWith('b.ts', 'head-commit')
  })
})
