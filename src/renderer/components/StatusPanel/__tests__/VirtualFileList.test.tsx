import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UnifiedFileRow } from '@/lib/status-file-rows'
import { VirtualFileList } from '../VirtualFileList'

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

describe('VirtualFileList — unified worktree + amend rows', () => {
  it('renders both a stageable worktree row and a droppable amend row in one list', () => {
    render(
      <VirtualFileList
        rows={[worktreeRow, amendRow]}
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
        rows={[worktreeRow, amendRow]}
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
        rows={[worktreeRow, amendRow]}
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
})
