import { fingerprintHunk } from '@shared/hunk-fingerprint'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SelectedFile } from '@/features/status/StatusPanel'
import { statusResponse } from '../../../../test/builders'
import { setupRepoChanged, sidecarMock } from '../../../../test/setup'
import {
  endLineSelection,
  hoverLine,
  lastCapturedFileDiffOptions,
  lastFileDiffOptions,
  mockDiffOn,
  renderDiffPanel,
  repoPath,
  setSelectedRows,
  twoHunkDiff
} from './diff-panel-test-harness'

describe('DiffPanel line selection', () => {
  const firstHeader = '@@ -1,3 +1,3 @@'
  const tailHeader = '@@ -28,3 +28,3 @@ function tail() {'

  it('enables line selection on the worktree surface', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(true)
  })

  it('stages the selected lines grouped by hunk and clears the selection', async () => {
    setSelectedRows([
      { line: 1, type: 'change-addition', index: '1,0' },
      { line: 2, type: 'context', index: '2,1' },
      { line: 29, type: 'change-addition', index: '6,4' }
    ])
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 29 })

    const stageButton = screen.getByRole('button', { name: 'Stage 2 selected lines' })
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    fireEvent.click(stageButton)

    await waitFor(() => {
      expect(sidecarMock.stageLines).toHaveBeenCalledWith(repoPath, 'src/app.ts', [
        {
          hunkHeader: firstHeader,
          lineIndexes: [1],
          fingerprint: fingerprintHunk(twoHunkDiff.patch, firstHeader)
        },
        {
          hunkHeader: tailHeader,
          lineIndexes: [2],
          fingerprint: fingerprintHunk(twoHunkDiff.patch, tailHeader)
        }
      ])
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Stage 2 selected lines' })
      ).not.toBeInTheDocument()
    })
    expect(sidecarMock.unstageLines).not.toHaveBeenCalled()
  })

  it('unstages the selected lines on the staged side', async () => {
    mockDiffOn('staged')
    setSelectedRows([{ line: 1, type: 'change-deletion', index: '0,0' }])
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Unstage 1 selected line' }))

    await waitFor(() => {
      expect(sidecarMock.unstageLines).toHaveBeenCalledWith(repoPath, 'src/app.ts', [
        {
          hunkHeader: firstHeader,
          lineIndexes: [0],
          fingerprint: fingerprintHunk(twoHunkDiff.patch, firstHeader)
        }
      ])
    })
    expect(sidecarMock.stageLines).not.toHaveBeenCalled()
  })

  it('keeps the selection when the diff refetches with unchanged content', async () => {
    const repoChanged = setupRepoChanged()
    setSelectedRows([{ line: 1, type: 'change-addition', index: '1,0' }])
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })
    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()

    const diffCallsBefore = sidecarMock.getDiff.mock.calls.length
    repoChanged.fire({ repoPath, kind: 'workingTree' })
    await waitFor(() => {
      expect(sidecarMock.getDiff.mock.calls.length).toBeGreaterThan(diffCallsBefore)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()
  })

  it('drops the previous selection as soon as a new sweep starts', async () => {
    setSelectedRows([{ line: 1, type: 'change-addition', index: '1,0' }])
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })
    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })
    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()

    const options = lastCapturedFileDiffOptions() as
      | { onLineSelectionEnd?: (range: { start: number; end: number } | null) => void }
      | undefined
    const diffNodes = screen.getAllByTestId('pierre-file-diff')
    const host = diffNodes[diffNodes.length - 1].querySelector('diffs-container')
    if (!host) {
      throw new Error('diffs host missing')
    }
    act(() => {
      host.querySelector('[data-selected-line]')?.remove()
      options?.onLineSelectionEnd?.({ start: 29, end: 29 })
    })

    expect(screen.queryByRole('button', { name: 'Stage 1 selected line' })).not.toBeInTheDocument()

    await act(async () => {
      const row = document.createElement('div')
      row.setAttribute('data-selected-line', '')
      row.setAttribute('data-line', '29')
      row.setAttribute('data-line-type', 'change-addition')
      row.setAttribute('data-line-index', '6,4')
      host.appendChild(row)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()
    })
  })

  it('waits for selection marks that the library paints frames after selection end', async () => {
    setSelectedRows([])
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })
    await screen.findByTestId('pierre-file-diff')

    const options = lastCapturedFileDiffOptions() as
      | { onLineSelectionEnd?: (range: { start: number; end: number } | null) => void }
      | undefined
    await act(async () => {
      options?.onLineSelectionEnd?.({ start: 1, end: 1 })
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      })
      const diffNodes = screen.getAllByTestId('pierre-file-diff')
      const host = diffNodes[diffNodes.length - 1].querySelector('diffs-container')
      if (!host) {
        throw new Error('diffs host missing')
      }
      const row = document.createElement('div')
      row.setAttribute('data-selected-line', '')
      row.setAttribute('data-line', '1')
      row.setAttribute('data-line-type', 'change-addition')
      row.setAttribute('data-line-index', '1,0')
      host.appendChild(row)
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()
    })
  })

  it('restores the hunk hover actions when the selection is cleared', async () => {
    setSelectedRows([{ line: 1, type: 'change-addition', index: '1,0' }])
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 1, end: 1 })
    expect(screen.getByRole('button', { name: 'Stage 1 selected line' })).toBeInTheDocument()

    await endLineSelection(null)

    expect(screen.queryByRole('button', { name: 'Stage 1 selected line' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage hunk' })).toBeInTheDocument()
    expect(sidecarMock.stageLines).not.toHaveBeenCalled()
  })

  it('offers no line action for a context-only selection', async () => {
    setSelectedRows([
      { line: 2, type: 'context', index: '2,1' },
      { line: 3, type: 'context', index: '3,2' }
    ])
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    await endLineSelection({ start: 2, end: 3 })

    expect(screen.queryByRole('button', { name: /selected line/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stage hunk' })).toBeInTheDocument()
  })

  it('disables line selection for conflicted files', async () => {
    sidecarMock.getStatus.mockResolvedValue(
      statusResponse({
        conflicted: ['src/app.ts'],
        files: [{ path: 'src/app.ts', index: 'U', working_dir: 'U' }]
      })
    )
    await renderDiffPanel({ file: 'src/app.ts', group: 'conflicts' })

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(false)
  })

  it('disables line selection for untracked files', async () => {
    sidecarMock.getStatus.mockResolvedValue(statusResponse({ not_added: ['src/app.ts'] }))
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(false)
  })

  it('disables line selection on the amend surface', async () => {
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      {
        dropState: 'kept',
        isHunkDropped: () => false,
        onToggleFile: vi.fn(),
        onToggleHunk: vi.fn()
      }
    )

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableLineSelection).toBe(false)
  })
})

describe('DiffPanel amend surface', () => {
  const headSelection: SelectedFile = {
    file: 'src/app.ts',
    source: 'head-commit',
    range: 'HEAD~1..HEAD'
  }

  it('drops the hovered hunk and reports the full header list', async () => {
    const onToggleHunk = vi.fn()
    await renderDiffPanel(headSelection, {
      dropState: 'kept',
      isHunkDropped: () => false,
      onToggleFile: vi.fn(),
      onToggleHunk
    })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard hunk' })).not.toBeInTheDocument()

    hoverLine(29, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Drop hunk' }))

    expect(onToggleHunk).toHaveBeenCalledWith('@@ -28,3 +28,3 @@ function tail() {', [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])
  })

  it('offers Keep on a dropped hunk, both on hover and as a persistent annotation', async () => {
    const onToggleHunk = vi.fn()
    const droppedHeader = '@@ -1,3 +1,3 @@'
    await renderDiffPanel(headSelection, {
      dropState: 'partial',
      isHunkDropped: (header) => header === droppedHeader,
      onToggleFile: vi.fn(),
      onToggleHunk
    })

    await screen.findByTestId('pierre-file-diff')
    const annotations = screen.getAllByTestId('pierre-annotation')
    const droppedAnnotation = annotations.find((node) => node.getAttribute('data-line') === '1')
    expect(droppedAnnotation).toBeDefined()
    expect(droppedAnnotation).toHaveTextContent('Dropped from last commit')

    fireEvent.click(
      within(droppedAnnotation as HTMLElement).getByRole('button', { name: 'Keep hunk 1 of 2' })
    )
    expect(onToggleHunk).toHaveBeenCalledWith(droppedHeader, [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])

    hoverLine(1, 'additions')
    expect(screen.getByRole('button', { name: 'Keep hunk' })).toBeInTheDocument()
  })

  it('renders a tri-state file drop checkbox for a head-commit file', async () => {
    const onToggleFile = vi.fn()
    await renderDiffPanel(headSelection, {
      dropState: 'partial',
      isHunkDropped: () => false,
      onToggleFile,
      onToggleHunk: vi.fn()
    })

    const fileCheckbox = await screen.findByRole('checkbox', {
      name: 'Keep src/app.ts in last commit'
    })
    expect((fileCheckbox as HTMLInputElement).indeterminate).toBe(true)

    fireEvent.click(fileCheckbox)
    expect(onToggleFile).toHaveBeenCalled()
  })

  it('reads the head-commit range, not the worktree', async () => {
    await renderDiffPanel(headSelection, {
      dropState: 'kept',
      isHunkDropped: () => false,
      onToggleFile: vi.fn(),
      onToggleHunk: vi.fn()
    })

    await screen.findByTestId('pierre-file-diff')
    expect(sidecarMock.getDiff).toHaveBeenCalledWith(repoPath, 'src/app.ts', false, {
      range: 'HEAD~1..HEAD',
      commit: undefined,
      renameSource: undefined
    })
  })
})
