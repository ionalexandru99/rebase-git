import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { statusResponse } from '../../../../test/builders'
import { sidecarMock } from '../../../../test/setup'
import {
  confirmRequests,
  emptyDiff,
  firstHunk,
  fixtureDiff,
  hoverLine,
  lastChangeCounts,
  lastFileDiffOptions,
  mockDiffOn,
  renderDiffPanel,
  repoPath,
  setHoveredLine,
  stagedSides,
  twoHunkDiff
} from './diff-panel-test-harness'

describe('DiffPanel hunk hover actions', () => {
  it('stages the hovered hunk with its exact header, resolved from an additions-side line', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(29, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
    expect(sidecarMock.unstageHunk).not.toHaveBeenCalled()
    expect(sidecarMock.discardHunk).not.toHaveBeenCalled()
  })

  it('offers a working affordance for a hunk starting at line 1', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(1, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(repoPath, 'src/app.ts', '@@ -1,3 +1,3 @@')
    })
  })

  it('unstages the hovered hunk on the staged side', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard hunk' })).not.toBeInTheDocument()
    hoverLine(1, 'deletions')
    fireEvent.click(screen.getByRole('button', { name: 'Unstage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,3 +1,3 @@'
      )
    })
  })

  it('ignores a click when nothing is hovered', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    setHoveredLine(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).not.toHaveBeenCalled()
    })
  })

  it('asks for confirmation before discarding a hunk, then discards on confirm', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(28, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Discard hunk' }))

    expect(sidecarMock.discardHunk).not.toHaveBeenCalled()
    expect(confirmRequests).toHaveLength(1)
    expect(confirmRequests[0].title).toBe('Discard hunk in src/app.ts?')
    expect(confirmRequests[0].destructive).toBe(true)

    await act(async () => {
      confirmRequests[0].onConfirm()
    })
    await waitFor(() => {
      expect(sidecarMock.discardHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
  })

  it('removes the staged hunk optimistically until the refetch lands', async () => {
    let unstagedCalls = 0
    let resolveStageHunk: () => void = () => {}
    let resolveRefetch: () => void = () => {}
    sidecarMock.getDiff.mockImplementation(
      async (_repo: string, _file: string, staged: boolean) => {
        if (staged) {
          return emptyDiff
        }
        unstagedCalls++
        if (unstagedCalls === 1) {
          return twoHunkDiff
        }
        return new Promise((resolve) => {
          resolveRefetch = () => resolve(fixtureDiff('src/app.ts', [firstHunk]))
        })
      }
    )
    sidecarMock.stageHunk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStageHunk = () => resolve({ _tag: 'Ok' })
        })
    )

    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })
    await screen.findByTestId('pierre-file-diff')
    expect(lastChangeCounts()).toEqual([1, 1])

    hoverLine(29, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(lastChangeCounts()).toEqual([1, 0])
    })

    resolveStageHunk()
    await waitFor(() => {
      expect(unstagedCalls).toBeGreaterThan(1)
    })
    expect(lastChangeCounts()).toEqual([1, 0])

    resolveRefetch()
    await waitFor(() => {
      expect(lastChangeCounts()).toEqual([1])
    })
  })

  it('restores the hunk when the mutation rejects outright', async () => {
    sidecarMock.stageHunk.mockRejectedValue(new Error('sidecar is gone'))
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    hoverLine(1, 'additions')
    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(lastChangeCounts()).toEqual([1, 1])
    })
  })

  it('offers no hunk actions for a conflicted file', async () => {
    sidecarMock.getStatus.mockResolvedValue(
      statusResponse({
        conflicted: ['src/app.ts'],
        files: [{ path: 'src/app.ts', index: 'U', working_dir: 'U' }]
      })
    )
    await renderDiffPanel({ file: 'src/app.ts', group: 'conflicts' })

    await screen.findByTestId('pierre-file-diff')
    expect(stagedSides()).toEqual([false])
    expect(lastFileDiffOptions().enableGutterUtility).toBe(false)
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard hunk' })).not.toBeInTheDocument()
  })

  it('hides hunk actions for untracked files', async () => {
    sidecarMock.getStatus.mockResolvedValue(statusResponse({ not_added: ['src/app.ts'] }))
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(lastFileDiffOptions().enableGutterUtility).toBe(false)
    expect(screen.queryByRole('button', { name: 'Stage hunk' })).not.toBeInTheDocument()
  })
})

describe('DiffPanel keyboard access', () => {
  it('offers focusable per-hunk annotation buttons on the unstaged side', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.getAllByTestId('pierre-annotation')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Stage hunk 1 of 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard hunk 1 of 2' })).toBeInTheDocument()

    const stageSecond = screen.getByRole('button', { name: 'Stage hunk 2 of 2' })
    stageSecond.focus()
    fireEvent.click(stageSecond)

    await waitFor(() => {
      expect(sidecarMock.stageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
  })

  it('offers a focusable unstage button per hunk on the staged side', async () => {
    mockDiffOn('staged')
    await renderDiffPanel({ file: 'src/app.ts', group: 'staged' })

    await screen.findByTestId('pierre-file-diff')
    const unstageFirst = screen.getByRole('button', { name: 'Unstage hunk 1 of 2' })
    unstageFirst.focus()
    fireEvent.click(unstageFirst)

    await waitFor(() => {
      expect(sidecarMock.unstageHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -1,3 +1,3 @@'
      )
    })
  })

  it('confirms before a keyboard-initiated discard', async () => {
    await renderDiffPanel({ file: 'src/app.ts', group: 'unstaged' })

    await screen.findByTestId('pierre-file-diff')
    fireEvent.click(screen.getByRole('button', { name: 'Discard hunk 2 of 2' }))

    expect(sidecarMock.discardHunk).not.toHaveBeenCalled()
    expect(confirmRequests).toHaveLength(1)

    await act(async () => {
      confirmRequests[0].onConfirm()
    })
    await waitFor(() => {
      expect(sidecarMock.discardHunk).toHaveBeenCalledWith(
        repoPath,
        'src/app.ts',
        '@@ -28,3 +28,3 @@ function tail() {'
      )
    })
  })

  it('offers focusable drop and keep buttons per hunk on the amend surface', async () => {
    const onToggleHunk = vi.fn()
    const droppedHeader = '@@ -1,3 +1,3 @@'
    await renderDiffPanel(
      { file: 'src/app.ts', source: 'head-commit', range: 'HEAD~1..HEAD' },
      {
        dropState: 'partial',
        isHunkDropped: (header) => header === droppedHeader,
        onToggleFile: vi.fn(),
        onToggleHunk
      }
    )

    await screen.findByTestId('pierre-file-diff')
    fireEvent.click(screen.getByRole('button', { name: 'Drop hunk 2 of 2' }))
    expect(onToggleHunk).toHaveBeenCalledWith('@@ -28,3 +28,3 @@ function tail() {', [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Keep hunk 1 of 2' }))
    expect(onToggleHunk).toHaveBeenCalledWith(droppedHeader, [
      '@@ -1,3 +1,3 @@',
      '@@ -28,3 +28,3 @@ function tail() {'
    ])
  })

  it('offers no annotation buttons for a conflicted file', async () => {
    sidecarMock.getStatus.mockResolvedValue(
      statusResponse({
        conflicted: ['src/app.ts'],
        files: [{ path: 'src/app.ts', index: 'U', working_dir: 'U' }]
      })
    )
    await renderDiffPanel({ file: 'src/app.ts', group: 'conflicts' })

    await screen.findByTestId('pierre-file-diff')
    expect(screen.queryAllByTestId('pierre-annotation')).toHaveLength(0)
  })
})
