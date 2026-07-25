import { act, renderHook } from '@testing-library/react'
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
