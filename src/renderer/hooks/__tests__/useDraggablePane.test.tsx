import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'
import { useDraggablePane } from '../useDraggablePane'

function drag(
  onResizeStart: (event: MouseEvent) => void,
  from: { clientX: number; clientY: number },
  to: { clientX: number; clientY: number }
) {
  act(() => {
    onResizeStart(new MouseEvent('mousedown', from))
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', to))
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

describe('useDraggablePane persistence', () => {
  it('applies a persisted size and open state', async () => {
    const load = async () => ({ open: false, size: 300 })
    const { result } = renderHook(() =>
      useDraggablePane({ min: 200, max: 520, defaultSize: 256, load })
    )

    await waitFor(() => expect(result.current.size).toBe(300))
    expect(result.current.isOpen).toBe(false)
  })

  it('clamps a persisted size into the configured bounds', async () => {
    const tooBig = async () => ({ open: true, size: 9000 })
    const oversized = renderHook(() =>
      useDraggablePane({ min: 200, max: 520, defaultSize: 256, load: tooBig })
    )
    await waitFor(() => expect(oversized.result.current.size).toBe(520))

    const tooSmall = async () => ({ open: true, size: 10 })
    const undersized = renderHook(() =>
      useDraggablePane({ min: 200, max: 520, defaultSize: 256, load: tooSmall })
    )
    await waitFor(() => expect(undersized.result.current.size).toBe(200))
  })

  it('keeps an in-flight drag instead of applying a late-arriving persisted size', async () => {
    let resolveLoad: (state: { open: boolean; size: number }) => void = () => {}
    const load = () =>
      new Promise<{ open: boolean; size: number }>((resolve) => {
        resolveLoad = resolve
      })
    const { result } = renderHook(() =>
      useDraggablePane({ min: 200, max: 520, defaultSize: 256, load })
    )

    act(() => {
      result.current.onResizeStart(new MouseEvent('mousedown', { clientX: 0 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
    })
    await act(async () => {
      resolveLoad({ open: true, size: 300 })
      await Promise.resolve()
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.size).toBe(356)
  })

  it('reports a failed load and keeps the default size', async () => {
    const failure = new Error('prefs unavailable')
    const load = async () => {
      throw failure
    }
    const onLoadError = vi.fn()
    const { result } = renderHook(() =>
      useDraggablePane({ min: 200, max: 520, defaultSize: 256, load, onLoadError })
    )

    await waitFor(() => expect(onLoadError).toHaveBeenCalledWith(failure))
    expect(result.current.size).toBe(256)
  })

  it('routes a rejected save through onSaveError', async () => {
    const failure = new Error('disk full')
    const save = () => Promise.reject(failure)
    const onSaveError = vi.fn()
    const { result } = renderHook(() =>
      useDraggablePane({ min: 200, max: 520, defaultSize: 256, save, onSaveError })
    )

    await act(async () => {
      result.current.setOpen(false)
    })

    expect(onSaveError).toHaveBeenCalledWith(failure)
  })
})

describe('useDraggablePane', () => {
  it('restores the default open layout when a reset is requested', () => {
    const save = vi.fn()
    const { result, rerender } = renderHook(
      ({ defaultSize }) =>
        useDraggablePane({
          min: 200,
          max: 520,
          defaultSize,
          save
        }),
      { initialProps: { defaultSize: 500 } }
    )
    rerender({ defaultSize: 256 })
    act(() => result.current.setOpen(false))
    expect(result.current.size).toBe(500)

    act(() => window.dispatchEvent(new Event(LAYOUT_RESET_EVENT)))

    expect(result.current.size).toBe(256)
    expect(result.current.isOpen).toBe(true)
    expect(save).toHaveBeenLastCalledWith({ open: true, size: 256 })
  })

  it('restores and persists the default size when a caller resets the pane directly', () => {
    const save = vi.fn()
    const { result } = renderHook(() =>
      useDraggablePane({ min: 100, max: 600, defaultSize: 300, save })
    )
    drag(result.current.onResizeStart, { clientX: 300, clientY: 0 }, { clientX: 500, clientY: 0 })
    expect(result.current.size).toBe(500)

    act(() => result.current.reset())

    expect(result.current.size).toBe(300)
    expect(save).toHaveBeenLastCalledWith({ open: true, size: 300 })
  })

  it('keeps one reset listener when every render passes a new save identity', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const savesByRender: Array<ReturnType<typeof vi.fn>> = []
    const { result, rerender, unmount } = renderHook(
      ({ marker }) => {
        void marker
        const save = vi.fn()
        savesByRender.push(save)
        return useDraggablePane({
          min: 200,
          max: 520,
          defaultSize: 256,
          save,
          onSaveError: vi.fn()
        })
      },
      { initialProps: { marker: 0 } }
    )

    rerender({ marker: 1 })
    rerender({ marker: 2 })

    expect(
      addEventListener.mock.calls.filter(([event]) => event === LAYOUT_RESET_EVENT)
    ).toHaveLength(1)
    expect(
      removeEventListener.mock.calls.filter(([event]) => event === LAYOUT_RESET_EVENT)
    ).toHaveLength(0)

    act(() => result.current.setOpen(false))
    const latestSave = savesByRender[savesByRender.length - 1]

    act(() => window.dispatchEvent(new Event(LAYOUT_RESET_EVENT)))

    expect(latestSave).toHaveBeenCalledWith({ open: true, size: 256 })
    expect(savesByRender[0]).not.toHaveBeenCalled()

    unmount()
    expect(
      removeEventListener.mock.calls.filter(([event]) => event === LAYOUT_RESET_EVENT)
    ).toHaveLength(1)
  })

  it('grows a horizontal pane as the pointer moves right and persists the result', () => {
    const save = vi.fn()
    const { result } = renderHook(() =>
      useDraggablePane({ min: 100, max: 600, defaultSize: 300, save })
    )

    drag(result.current.onResizeStart, { clientX: 300, clientY: 0 }, { clientX: 380, clientY: 0 })

    expect(result.current.size).toBe(380)
    expect(save).toHaveBeenLastCalledWith({ open: true, size: 380 })
  })

  it('grows a bottom panel as the pointer drags its top edge upward', () => {
    const { result } = renderHook(() =>
      useDraggablePane({
        min: 120,
        max: 600,
        defaultSize: 240,
        axis: 'vertical',
        handle: 'start'
      })
    )

    drag(result.current.onResizeStart, { clientX: 0, clientY: 500 }, { clientX: 0, clientY: 400 })

    expect(result.current.size).toBe(340)
  })

  it('clamps a vertical drag to the configured bounds', () => {
    const { result } = renderHook(() =>
      useDraggablePane({
        min: 120,
        max: 400,
        defaultSize: 240,
        axis: 'vertical',
        handle: 'start'
      })
    )

    drag(result.current.onResizeStart, { clientX: 0, clientY: 500 }, { clientX: 0, clientY: 0 })
    expect(result.current.size).toBe(400)

    drag(result.current.onResizeStart, { clientX: 0, clientY: 500 }, { clientX: 0, clientY: 900 })
    expect(result.current.size).toBe(120)
  })

  it('ignores horizontal pointer movement on a vertical pane', () => {
    const { result } = renderHook(() =>
      useDraggablePane({ min: 120, max: 600, defaultSize: 240, axis: 'vertical', handle: 'start' })
    )

    drag(result.current.onResizeStart, { clientX: 0, clientY: 500 }, { clientX: 900, clientY: 500 })

    expect(result.current.size).toBe(240)
  })
})
