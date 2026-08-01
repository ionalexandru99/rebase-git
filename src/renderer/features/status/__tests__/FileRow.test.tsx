import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileRow } from '../FileRow'

describe('FileRow — unstaged group', () => {
  const renderRow = (overrides: Partial<Parameters<typeof FileRow>[0]> = {}) => {
    const onStage = vi.fn()
    const onUnstage = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        group="unstaged"
        isSelected={false}
        onSelect={vi.fn()}
        onStage={onStage}
        onUnstage={onUnstage}
        {...overrides}
      />
    )
    return { onStage, onUnstage }
  }

  it('indicates the unstaged state with an empty box, not a form checkbox', () => {
    renderRow()

    const indicator = screen.getByTestId('file-stage-indicator')
    expect(indicator).toHaveAttribute('data-state', 'unstaged')
    expect(indicator).toHaveAttribute('aria-label', 'Stage src/app.ts')
    expect(indicator).toBeEmptyDOMElement()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('leads the row with the state indicator', () => {
    renderRow()

    expect(screen.getByTestId('status-file-row').firstElementChild).toBe(
      screen.getByTestId('file-stage-indicator')
    )
  })

  it('stages the file through its row button', () => {
    const { onStage } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Stage src/app.ts' }))
    expect(onStage).toHaveBeenCalledWith('src/app.ts')
  })

  it('stages the file on double-click', () => {
    const { onStage } = renderRow()

    fireEvent.doubleClick(screen.getByText('src/app.ts'))
    expect(onStage).toHaveBeenCalledWith('src/app.ts')
  })

  it('stages once when its row button is double-tapped', () => {
    const { onStage } = renderRow()
    const button = screen.getByRole('button', { name: 'Stage src/app.ts' })

    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 2 })
    fireEvent.doubleClick(button)

    expect(onStage).toHaveBeenCalledTimes(1)
  })

  it('still stages on a keyboard activation, which carries no click count', () => {
    const { onStage } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Stage src/app.ts' }), { detail: 0 })
    expect(onStage).toHaveBeenCalledTimes(1)
  })

  it('stages the file from the context menu', () => {
    const { onStage } = renderRow()

    fireEvent.contextMenu(screen.getByText('src/app.ts'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stage' }))
    expect(onStage).toHaveBeenCalledWith('src/app.ts')
  })

  it('tags the row with its group and path so the lists can be told apart', () => {
    renderRow()

    const row = screen.getByTestId('status-file-row')
    expect(row).toHaveAttribute('data-group', 'unstaged')
    expect(row).toHaveAttribute('data-file', 'src/app.ts')
  })
})

describe('FileRow — staged group', () => {
  const renderRow = (overrides: Partial<Parameters<typeof FileRow>[0]> = {}) => {
    const onUnstage = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        group="staged"
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={onUnstage}
        {...overrides}
      />
    )
    return { onUnstage }
  }

  it('unstages the file through its row button', () => {
    const { onUnstage } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Unstage src/app.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('src/app.ts')
  })

  it('indicates the staged state with a tick', () => {
    renderRow()

    const indicator = screen.getByTestId('file-stage-indicator')
    expect(indicator).toHaveAttribute('data-state', 'staged')
    expect(indicator).toHaveTextContent('✓')
    expect(indicator).toHaveAttribute('aria-label', 'Unstage src/app.ts')
  })

  it('unstages the file on double-click', () => {
    const { onUnstage } = renderRow()

    fireEvent.doubleClick(screen.getByText('src/app.ts'))
    expect(onUnstage).toHaveBeenCalledWith('src/app.ts')
  })

  it('carries the rename source when unstaging', () => {
    const { onUnstage } = renderRow({
      file: 'new.ts',
      renameSource: 'old.ts',
      display: 'old.ts → new.ts',
      kind: 'renamed'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage old.ts → new.ts' }))
    expect(onUnstage).toHaveBeenCalledWith('new.ts', 'old.ts')
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
        group="conflicts"
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

  it('still withholds Discard changes when no resolver is wired up', () => {
    render(
      <FileRow
        file="src/app.ts"
        kind="conflicted"
        group="conflicts"
        conflictCode="UU"
        conflictLabels={labels}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onFileAction={vi.fn()}
      />
    )
    fireEvent.contextMenu(screen.getByText('src/app.ts'))

    expect(screen.queryByRole('menuitem', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Mark as resolved' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Keep/ })).not.toBeInTheDocument()
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
        group="conflicts"
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

  it('indicates the conflicted state with a warning glyph', () => {
    const onStage = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="conflicted"
        group="conflicts"
        conflictCode="UU"
        conflictLabels={labels}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
        onResolveConflict={vi.fn()}
      />
    )

    const indicator = screen.getByTestId('file-stage-indicator')
    expect(indicator).toHaveAttribute('data-state', 'conflicted')
    expect(indicator).toHaveTextContent('!')
    expect(indicator).toHaveAttribute('aria-label', 'Mark src/app.ts as resolved')

    fireEvent.click(indicator)
    expect(onStage).toHaveBeenCalledWith('src/app.ts')
  })

  it('names its row button after resolving rather than staging', () => {
    const onStage = vi.fn()
    render(
      <FileRow
        file="src/app.ts"
        kind="conflicted"
        group="conflicts"
        conflictCode="UU"
        conflictLabels={labels}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
        onResolveConflict={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark src/app.ts as resolved' }))
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
        group="head-commit"
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
  })

  it('renders a dropped file as unchecked', () => {
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        group="head-commit"
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
        group="head-commit"
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

  it('offers no staging action for a committed file', () => {
    render(
      <FileRow
        file="src/app.ts"
        kind="modified"
        group="head-commit"
        dropState="kept"
        isSelected={false}
        onSelect={vi.fn()}
        onToggleDrop={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /^(Stage|Unstage) / })).not.toBeInTheDocument()
  })
})
