import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStableCallback } from '@/hooks/useStableCallback'

describe('useStableCallback', () => {
  it('keeps the same function across rerenders', () => {
    const { result, rerender } = renderHook(({ callback }) => useStableCallback(callback), {
      initialProps: { callback: () => 'first' }
    })
    const stable = result.current

    rerender({ callback: () => 'second' })
    rerender({ callback: () => 'third' })

    expect(result.current).toBe(stable)
  })

  it('calls the newest callback, not the one it was created with', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ callback }) => useStableCallback(callback), {
      initialProps: { callback: first }
    })

    rerender({ callback: second })
    result.current()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('passes arguments through and returns the result', () => {
    const { result } = renderHook(() =>
      useStableCallback((left: number, right: number) => left + right)
    )

    expect(result.current(2, 3)).toBe(5)
  })

  it('reads the latest closure even when a stale reference is invoked', () => {
    const { result, rerender } = renderHook(({ label }) => useStableCallback(() => label), {
      initialProps: { label: 'before' }
    })
    const captured = result.current

    rerender({ label: 'after' })

    expect(captured()).toBe('after')
  })
})
