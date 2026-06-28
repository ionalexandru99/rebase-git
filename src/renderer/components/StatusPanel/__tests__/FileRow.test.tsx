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
