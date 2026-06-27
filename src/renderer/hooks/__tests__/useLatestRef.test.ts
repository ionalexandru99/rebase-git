import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLatestRef } from '../useLatestRef'

describe('useLatestRef', () => {
  it('exposes the latest value through a stable ref', () => {
    const { result, rerender } = renderHook((value: number) => useLatestRef(value), {
      initialProps: 1
    })
    const ref = result.current
    expect(ref.current).toBe(1)

    rerender(2)
    expect(result.current).toBe(ref)
    expect(ref.current).toBe(2)
  })

  it('lets a callback bound once read the latest value at call time', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(
      ({ run }: { run: () => void }) => useLatestRef({ run }),
      { initialProps: { run: first } }
    )
    const ref = result.current
    const fire = () => ref.current.run()

    rerender({ run: second })
    fire()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
