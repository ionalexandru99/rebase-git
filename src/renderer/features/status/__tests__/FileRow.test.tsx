import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileRow } from '../FileRow'

describe('FileRow — worktree', () => {
  it('renders a stage checkbox and stages on toggle', () => {
    const onStage = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        stageState="unstaged"
        source="worktree"
        isSelected={false}
        onSelect={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
      />
    )

    const checkbox = screen.getByRole('checkbox', { name: /stage src\/app\.ts/i })
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    expect(onStage).toHaveBeenCalledWith('src/app.ts')
  })
})

describe('FileRow — conflicted', () => {
  const labels = { oursLabel: 'main', theirsLabel: 'feature/login' }

  function renderConflict(conflictCode: string | undefined) {
    const onResolveConflict = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="conflicted"
        stageState="unstaged"
        source="worktree"
        conflictCode={conflictCode}
        conflictLabels={labels}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onResolveConflict={onResolveConflict}
      />
    )
    fireEvent.contextMenu(screen.getByText('src/app.ts'))
    return { onResolveConflict }
  }

  it('resolves a both-modified conflict with the named refs', () => {
    const { onResolveConflict } = renderConflict('UU')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep main' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/app.ts', 'ours')
  })

  it('resolves a both-modified conflict toward the incoming ref', () => {
    const { onResolveConflict } = renderConflict('UU')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep feature/login' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/app.ts', 'theirs')
  })

  it('keeps the surviving blob when this side deleted the file (DU)', () => {
    const { onResolveConflict } = renderConflict('DU')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep the file' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/app.ts', 'theirs')
  })

  it('deletes the file from the side that still has it (DU)', () => {
    const { onResolveConflict } = renderConflict('DU')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete the file' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/app.ts', 'ours')
  })

  it('keeps the surviving blob when the other side deleted the file (UD)', () => {
    const { onResolveConflict } = renderConflict('UD')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep the file' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/app.ts', 'ours')
  })

  it('deletes the file on the side that still has it (UD)', () => {
    const { onResolveConflict } = renderConflict('UD')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete the file' }))
    expect(onResolveConflict).toHaveBeenCalledWith('src/app.ts', 'theirs')
  })

  it('withholds Discard changes while the file is conflicted', () => {
    renderConflict('UU')

    expect(screen.queryByRole('menuitem', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Mark as resolved' })).toBeInTheDocument()
  })

  it('offers no keep choices when both sides deleted the file (DD)', () => {
    renderConflict('DD')

    expect(screen.queryByRole('menuitem', { name: /^Keep/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete the file' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Both sides deleted this file. Stage it to mark it resolved.')
    ).toBeInTheDocument()
  })

  it('marks a conflict resolved through the menu', () => {
    const onStage = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="conflicted"
        stageState="unstaged"
        source="worktree"
        conflictCode="UU"
        conflictLabels={labels}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
        onResolveConflict={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByText('src/app.ts'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as resolved' }))
    expect(onStage).toHaveBeenCalledWith('src/app.ts')
  })

  it('never writes the words ours or theirs into the menu', () => {
    renderConflict('UU')

    const menu = screen.getByRole('menu')
    expect(menu.textContent?.toLowerCase()).not.toContain('ours')
    expect(menu.textContent?.toLowerCase()).not.toContain('theirs')
  })
})

describe('FileRow — head-commit (amend)', () => {
  it('renders a kept (checked) drop checkbox and drops on toggle', () => {
    const onToggleDrop = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        stageState="staged"
        source="head-commit"
        dropState="kept"
        isSelected={false}
        onSelect={vi.fn()}
        onToggleDrop={onToggleDrop}
      />
    )

    const checkbox = screen.getByRole('checkbox', { name: /drop src\/app\.ts from last commit/i })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(onToggleDrop).toHaveBeenCalledWith('src/app.ts')
    expect(screen.getByText('Last commit')).toBeInTheDocument()
  })

  it('renders a dropped file as unchecked', () => {
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        stageState="staged"
        source="head-commit"
        dropState="dropped"
        isSelected={false}
        onSelect={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    expect(
      screen.getByRole('checkbox', { name: /keep src\/app\.ts in last commit/i })
    ).not.toBeChecked()
  })

  it('renders a partially-dropped file as indeterminate', () => {
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        stageState="staged"
        source="head-commit"
        dropState="partial"
        isSelected={false}
        onSelect={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: /keep src\/app\.ts in last commit/i
    }) as HTMLInputElement
    expect(checkbox.indeterminate).toBe(true)
    expect(checkbox).not.toBeChecked()
  })
})
