import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncer, ignoreWorkingTree } from './repoWatcher'

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

describe('ignoreWorkingTree', () => {
  it('ignores the .git directory', () => {
    expect(ignoreWorkingTree('/repo/.git/HEAD')).toBe(true)
  })

  it('ignores common build-output dirs at any depth', () => {
    expect(ignoreWorkingTree('/repo/node_modules/foo/index.js')).toBe(true)
    expect(ignoreWorkingTree('/repo/target/debug/main')).toBe(true)
    expect(ignoreWorkingTree('/repo/packages/app/dist/bundle.js')).toBe(true)
    expect(ignoreWorkingTree('/repo/out/main/index.js')).toBe(true)
    expect(ignoreWorkingTree('/repo/.next/cache/foo')).toBe(true)
    expect(ignoreWorkingTree('/repo/.turbo/run.log')).toBe(true)
    expect(ignoreWorkingTree('/repo/coverage/lcov-report/index.html')).toBe(true)
    expect(ignoreWorkingTree('/repo/playwright-report/index.html')).toBe(true)
    expect(ignoreWorkingTree('/repo/test-results/results.xml')).toBe(true)
  })

  it('does not ignore source files', () => {
    expect(ignoreWorkingTree('/repo/src/main.ts')).toBe(false)
    expect(ignoreWorkingTree('/repo/README.md')).toBe(false)
    expect(ignoreWorkingTree('/repo/package.json')).toBe(false)
  })

  it('does not ignore files whose name merely contains an ignored token', () => {
    expect(ignoreWorkingTree('/repo/src/build-config.ts')).toBe(false)
    expect(ignoreWorkingTree('/repo/dist-info.md')).toBe(false)
  })

  it('handles Windows-style separators', () => {
    expect(ignoreWorkingTree('C:\\repo\\node_modules\\foo')).toBe(true)
    expect(ignoreWorkingTree('C:\\repo\\src\\main.ts')).toBe(false)
  })

  it('matches case-insensitively for case-insensitive filesystems', () => {
    expect(ignoreWorkingTree('/repo/Node_Modules/foo')).toBe(true)
    expect(ignoreWorkingTree('/repo/NODE_MODULES/foo')).toBe(true)
    expect(ignoreWorkingTree('/repo/.GIT/HEAD')).toBe(true)
    expect(ignoreWorkingTree('/repo/Target/release/bin')).toBe(true)
  })
})
