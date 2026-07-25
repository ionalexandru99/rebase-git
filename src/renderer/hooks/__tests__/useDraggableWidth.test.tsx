import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'
import { useDraggableWidth } from '../useDraggableWidth'

describe('useDraggableWidth', () => {
  it('restores the default open layout when a reset is requested', () => {
    const save = vi.fn()
    const { result, rerender } = renderHook(
      ({ defaultWidth }) =>
        useDraggableWidth({
          min: 200,
          max: 520,
          defaultWidth,
          save
        }),
      { initialProps: { defaultWidth: 500 } }
    )
    rerender({ defaultWidth: 256 })
    act(() => result.current.setOpen(false))
    expect(result.current.width).toBe(500)

    act(() => window.dispatchEvent(new Event(LAYOUT_RESET_EVENT)))

    expect(result.current.width).toBe(256)
    expect(result.current.isOpen).toBe(true)
    expect(save).toHaveBeenLastCalledWith({ open: true, width: 256 })
  })

  it('keeps one reset listener while unrelated renders occur', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const save = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ marker }) => {
        void marker
        return useDraggableWidth({
          min: 200,
          max: 520,
          defaultWidth: 256,
          save
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

    unmount()
    expect(
      removeEventListener.mock.calls.filter(([event]) => event === LAYOUT_RESET_EVENT)
    ).toHaveLength(1)
  })
})
