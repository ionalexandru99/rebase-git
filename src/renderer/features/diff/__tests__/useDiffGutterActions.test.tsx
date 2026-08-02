import { parseUnifiedDiff } from '@shared/unified-diff'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDiffGutterActions } from '@/features/diff/useDiffGutterActions'
import { DELETE_PATCH, MULTI_HUNK_PATCH } from './patch-fixtures'

const hunks = parseUnifiedDiff(MULTI_HUNK_PATCH).hunks

function createInput(
  overrides: Partial<Parameters<typeof useDiffGutterActions>[0]> = {}
): Parameters<typeof useDiffGutterActions>[0] {
  return {
    hunks,
    hunkActionsEnabled: true,
    activeLineCount: null,
    showsStagedSide: false,
    runLineAction: vi.fn(),
    requestHunkAction: vi.fn(),
    ...overrides
  }
}

describe('useDiffGutterActions', () => {
  it('builds annotations on the side where each hunk has content', () => {
    const deletionHunk = parseUnifiedDiff(DELETE_PATCH).hunks[0]
    const { result } = renderHook(() =>
      useDiffGutterActions(createInput({ hunks: [...hunks, deletionHunk] }))
    )

    expect(result.current.hunkAnnotations).toEqual([
      {
        side: 'additions',
        lineNumber: 1,
        metadata: { header: '@@ -1,4 +1,4 @@' }
      },
      {
        side: 'additions',
        lineNumber: 33,
        metadata: { header: '@@ -33,7 +33,7 @@ line 32' }
      },
      {
        side: 'deletions',
        lineNumber: 1,
        metadata: { header: '@@ -1 +0,0 @@' }
      }
    ])
  })

  it('routes hover actions to the exact hunk', () => {
    const requestHunkAction = vi.fn()
    const { result } = renderHook(() => useDiffGutterActions(createInput({ requestHunkAction })))
    render(result.current.renderGutterUtility(() => ({ lineNumber: 36, side: 'additions' })))

    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk' }))

    expect(requestHunkAction).toHaveBeenCalledWith('stage', hunks[1])
  })

  it('does not rerender for hovered lines when amend controls are absent', () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useDiffGutterActions(createInput())
    })

    act(() => result.current.onLineEnter({ lineNumber: 36, annotationSide: 'additions' }))

    expect(renderCount).toBe(1)
  })

  it('replaces hunk controls with the active staged-line action', () => {
    const runLineAction = vi.fn()
    const requestHunkAction = vi.fn()
    const { result } = renderHook(() =>
      useDiffGutterActions(
        createInput({
          activeLineCount: 2,
          showsStagedSide: true,
          runLineAction,
          requestHunkAction
        })
      )
    )
    render(result.current.renderGutterUtility(() => ({ lineNumber: 1, side: 'deletions' })))

    fireEvent.click(screen.getByRole('button', { name: 'Unstage 2 selected lines' }))

    expect(runLineAction).toHaveBeenCalledOnce()
    expect(requestHunkAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Unstage hunk' })).not.toBeInTheDocument()
  })

  it('provides focusable per-hunk stage and discard actions', () => {
    const requestHunkAction = vi.fn()
    const { result } = renderHook(() => useDiffGutterActions(createInput({ requestHunkAction })))
    const annotation = result.current.hunkAnnotations?.[1]
    if (!annotation) {
      throw new Error('second annotation missing')
    }
    render(result.current.renderAnnotation(annotation))

    fireEvent.click(screen.getByRole('button', { name: 'Stage hunk 2 of 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard hunk 2 of 2' }))

    expect(requestHunkAction).toHaveBeenNthCalledWith(1, 'stage', hunks[1])
    expect(requestHunkAction).toHaveBeenNthCalledWith(2, 'discard', hunks[1])
  })

  it('switches dropped amend hunks from Drop to Keep on hover and annotations', () => {
    const onToggleHunk = vi.fn()
    const droppedHeader = hunks[0]?.header
    const amendDrop = {
      dropState: 'partial' as const,
      isHunkDropped: (header: string) => header === droppedHeader,
      onToggleFile: vi.fn(),
      onToggleHunk
    }
    const { result } = renderHook(() =>
      useDiffGutterActions(createInput({ amendDrop, hunkActionsEnabled: false }))
    )
    act(() => result.current.onLineEnter({ lineNumber: 1, annotationSide: 'additions' }))

    const hover = render(
      result.current.renderGutterUtility(() => ({ lineNumber: 1, side: 'additions' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Keep hunk' }))
    expect(onToggleHunk).toHaveBeenLastCalledWith(
      droppedHeader,
      hunks.map((hunk) => hunk.header)
    )
    hover.unmount()

    const annotation = result.current.hunkAnnotations?.[0]
    if (!annotation) {
      throw new Error('first annotation missing')
    }
    render(result.current.renderAnnotation(annotation))
    expect(screen.getByText('Dropped from last commit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep hunk 1 of 2' }))
    expect(onToggleHunk).toHaveBeenLastCalledWith(
      droppedHeader,
      hunks.map((hunk) => hunk.header)
    )
  })

  it('disables annotations and utilities together', () => {
    const { result } = renderHook(() =>
      useDiffGutterActions(createInput({ hunkActionsEnabled: false }))
    )

    expect(result.current.gutterEnabled).toBe(false)
    expect(result.current.hunkAnnotations).toBeUndefined()
    expect(result.current.renderGutterUtility(() => undefined)).toBeNull()
  })
})
