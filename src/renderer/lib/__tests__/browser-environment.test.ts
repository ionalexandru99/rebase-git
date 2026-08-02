import { describe, expect, it, vi } from 'vitest'
import { resizeObserverMock } from '../../../test/setup'

describe('browser test environment', () => {
  it('forgets observers when the environment resets', () => {
    const callback = vi.fn()
    const observer = new window.ResizeObserver(callback)
    observer.observe(document.createElement('div'))

    resizeObserverMock.reset()
    resizeObserverMock.setContentRect({ width: 900 })

    expect(callback).toHaveBeenCalledOnce()
  })

  it('allows tests to replace the ResizeObserver implementation', () => {
    expect(Object.getOwnPropertyDescriptor(window, 'ResizeObserver')?.configurable).toBe(true)
  })
})
