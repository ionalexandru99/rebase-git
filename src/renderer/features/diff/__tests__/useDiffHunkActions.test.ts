import { parseUnifiedDiff } from '@shared/unified-diff'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDiffHunkActions } from '@/features/diff/useDiffHunkActions'
import { MODIFY_PATCH } from './patch-fixtures'

const hunk = parseUnifiedDiff(MODIFY_PATCH).hunks[0]

function setup(overrides: Partial<Parameters<typeof useDiffHunkActions>[0]> = {}) {
  const options: Parameters<typeof useDiffHunkActions>[0] = {
    selectedFile: 'src/app.ts',
    showsStagedSide: false,
    hunks: [hunk],
    dataUpdatedAt: 10,
    stageHunk: vi.fn().mockResolvedValue(true),
    unstageHunk: vi.fn().mockResolvedValue(true),
    discardHunk: vi.fn().mockResolvedValue(true),
    confirm: vi.fn(),
    ...overrides
  }
  const rendered = renderHook(
    (currentOptions: Parameters<typeof useDiffHunkActions>[0]) =>
      useDiffHunkActions(currentOptions),
    { initialProps: options }
  )
  return { options, ...rendered }
}

describe('useDiffHunkActions', () => {
  it('optimistically accepts a staged hunk and identifies the last hunk on its side', async () => {
    const { options, result } = setup()

    act(() => {
      result.current.requestHunkAction('stage', hunk)
    })

    await waitFor(() => {
      expect(options.stageHunk).toHaveBeenCalledWith('src/app.ts', hunk.header, {
        fullyStagesFile: true
      })
    })
    expect(result.current.activePending).toMatchObject({
      file: 'src/app.ts',
      header: hunk.header,
      resolution: 'accept'
    })
  })

  it('optimistically rejects an unstaged hunk without marking one of many as the last', async () => {
    const secondHunk = { ...hunk, header: '@@ -20,1 +20,1 @@' }
    const { options, result } = setup({ showsStagedSide: true, hunks: [hunk, secondHunk] })

    act(() => {
      result.current.requestHunkAction('unstage', hunk)
    })

    await waitFor(() => {
      expect(options.unstageHunk).toHaveBeenCalledWith('src/app.ts', hunk.header, {
        fullyUnstagesFile: false
      })
    })
    expect(result.current.activePending?.resolution).toBe('reject')
  })

  it('defers destructive hunk removal until confirmation', async () => {
    const { options, result } = setup()

    act(() => {
      result.current.requestHunkAction('discard', hunk)
    })

    expect(options.discardHunk).not.toHaveBeenCalled()
    expect(options.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Discard hunk in src/app.ts?',
        confirmText: 'Discard',
        destructive: true
      })
    )

    const request = vi.mocked(options.confirm).mock.calls[0][0]
    act(() => {
      request.onConfirm()
    })

    await waitFor(() => {
      expect(options.discardHunk).toHaveBeenCalledWith('src/app.ts', hunk.header)
    })
  })

  it('rolls back its optimistic removal when the operation rejects', async () => {
    const stageHunk = vi.fn().mockRejectedValue(new Error('sidecar unavailable'))
    const { result } = setup({ stageHunk })

    act(() => {
      result.current.requestHunkAction('stage', hunk)
    })

    await waitFor(() => {
      expect(stageHunk).toHaveBeenCalled()
      expect(result.current.activePending).toBeNull()
    })
  })

  it('stops applying an optimistic removal after fresh diff data arrives', async () => {
    const { options, result, rerender } = setup()

    act(() => {
      result.current.requestHunkAction('stage', hunk)
    })
    await waitFor(() => {
      expect(options.stageHunk).toHaveBeenCalled()
    })

    rerender({ ...options, dataUpdatedAt: 11 })

    expect(result.current.activePending).toBeNull()
  })
})
