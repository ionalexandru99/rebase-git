import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncer } from './repoWatcher'

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires the callback once after the delay', () => {
    const debouncer = createDebouncer<'refs'>(100)
    const fn = vi.fn()

    debouncer.schedule('refs', fn)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid schedules for the same key into a single fire', () => {
    const debouncer = createDebouncer<'refs'>(100)
    const fn = vi.fn()

    debouncer.schedule('refs', fn)
    vi.advanceTimersByTime(50)
    debouncer.schedule('refs', fn)
    vi.advanceTimersByTime(50)
    debouncer.schedule('refs', fn)
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fires independently per key', () => {
    const debouncer = createDebouncer<'refs' | 'workingTree'>(100)
    const refsFn = vi.fn()
    const treeFn = vi.fn()

    debouncer.schedule('refs', refsFn)
    debouncer.schedule('workingTree', treeFn)
    vi.advanceTimersByTime(100)

    expect(refsFn).toHaveBeenCalledTimes(1)
    expect(treeFn).toHaveBeenCalledTimes(1)
  })

  it('cancelAll prevents pending callbacks from firing', () => {
    const debouncer = createDebouncer<'refs' | 'workingTree'>(100)
    const refsFn = vi.fn()
    const treeFn = vi.fn()

    debouncer.schedule('refs', refsFn)
    debouncer.schedule('workingTree', treeFn)
    debouncer.cancelAll()
    vi.advanceTimersByTime(500)

    expect(refsFn).not.toHaveBeenCalled()
    expect(treeFn).not.toHaveBeenCalled()
  })
})
