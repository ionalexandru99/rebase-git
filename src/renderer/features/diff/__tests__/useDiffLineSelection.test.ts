import { parseUnifiedDiff } from '@shared/unified-diff'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDiffLineSelection } from '@/features/diff/useDiffLineSelection'
import { MODIFY_PATCH } from './patch-fixtures'

const hunks = parseUnifiedDiff(MODIFY_PATCH).hunks
const selectedLine = { kind: 'add' as const, lineNumber: 2, unifiedIndex: 2 }

function setup(overrides: Partial<Parameters<typeof useDiffLineSelection>[0]> = {}) {
  const frames: Array<() => void> = []
  const options: Parameters<typeof useDiffLineSelection>[0] = {
    selectedFile: 'simple.txt',
    showsStagedSide: false,
    patch: MODIFY_PATCH,
    patchKey: 'patch-1',
    hunks,
    stageLines: vi.fn().mockResolvedValue(true),
    unstageLines: vi.fn().mockResolvedValue(true),
    collectSelectedLines: vi.fn().mockReturnValue([selectedLine]),
    scheduleFrame: (callback) => frames.push(callback),
    ...overrides
  }
  const rendered = renderHook(
    (currentOptions: Parameters<typeof useDiffLineSelection>[0]) =>
      useDiffLineSelection(currentOptions),
    { initialProps: options }
  )
  rendered.result.current.diffBodyRef.current = document.createElement('div')
  return { frames, options, ...rendered }
}

function runNextFrame(frames: Array<() => void>) {
  const frame = frames.shift()
  if (!frame) {
    throw new Error('expected a scheduled selection sweep')
  }
  act(() => {
    frame()
  })
}

function settleSelection(result: ReturnType<typeof setup>) {
  act(() => {
    result.result.current.onLineSelectionEnd({ start: 2, end: 2 })
  })
  runNextFrame(result.frames)
  runNextFrame(result.frames)
}

describe('useDiffLineSelection', () => {
  it('waits for a stable DOM selection before exposing its action', () => {
    const result = setup()

    act(() => {
      result.result.current.onLineSelectionEnd({ start: 2, end: 2 })
    })
    expect(result.result.current.activeLineSelection).toBeNull()

    runNextFrame(result.frames)
    expect(result.result.current.activeLineSelection).toBeNull()

    runNextFrame(result.frames)
    expect(result.result.current.activeLineSelection?.lines).toEqual([selectedLine])
  })

  it('maps and stages selected lines, then clears the applied selection', async () => {
    const result = setup()
    settleSelection(result)

    await act(async () => {
      await result.result.current.runLineAction()
    })

    expect(result.options.stageLines).toHaveBeenCalledWith('simple.txt', [
      expect.objectContaining({ hunkHeader: '@@ -1,3 +1,3 @@', lineIndexes: [2] })
    ])
    expect(result.result.current.activeLineSelection).toBeNull()
  })

  it('routes staged selections to unstage and keeps them when application fails', async () => {
    const unstageLines = vi.fn().mockResolvedValue(false)
    const result = setup({ showsStagedSide: true, unstageLines })
    settleSelection(result)

    await act(async () => {
      await result.result.current.runLineAction()
    })

    expect(unstageLines).toHaveBeenCalledWith('simple.txt', expect.any(Array))
    expect(result.result.current.activeLineSelection?.lines).toEqual([selectedLine])
  })

  it('clears selected rows that cannot be mapped to a hunk', async () => {
    const result = setup({
      collectSelectedLines: vi
        .fn()
        .mockReturnValue([{ kind: 'add', lineNumber: 999, unifiedIndex: 2 }])
    })
    settleSelection(result)

    await act(async () => {
      await result.result.current.runLineAction()
    })

    expect(result.options.stageLines).not.toHaveBeenCalled()
    expect(result.result.current.activeLineSelection).toBeNull()
  })

  it('cancels an obsolete sweep when selection is cleared', () => {
    const result = setup()

    act(() => {
      result.result.current.onLineSelectionEnd({ start: 2, end: 2 })
      result.result.current.onLineSelectionEnd(null)
    })
    runNextFrame(result.frames)

    expect(result.options.collectSelectedLines).not.toHaveBeenCalled()
    expect(result.result.current.activeLineSelection).toBeNull()
  })

  it('stops exposing a selection when the displayed patch changes', () => {
    const result = setup()
    settleSelection(result)

    result.rerender({ ...result.options, patchKey: 'patch-2' })

    expect(result.result.current.activeLineSelection).toBeNull()
  })
})
