import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ignoreWorkingTree, shouldEmitWorkingTreeChange, startDebouncedDrain } from '../repoWatcher'

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

describe('shouldEmitWorkingTreeChange', () => {
  it('does not echo git-internal watcher events as working-tree changes', () => {
    expect(shouldEmitWorkingTreeChange('.git/index')).toBe(false)
    expect(shouldEmitWorkingTreeChange('.git/refs/heads/main')).toBe(false)
  })

  it('ignores native watcher events without a filename', () => {
    expect(shouldEmitWorkingTreeChange(null)).toBe(false)
  })

  it('emits source file changes', () => {
    expect(shouldEmitWorkingTreeChange('src/main.ts')).toBe(true)
  })
})

describe('startDebouncedDrain', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fires once after events go idle', () => {
    const onFire = vi.fn()
    const drain = startDebouncedDrain(30, onFire)

    drain.push()
    drain.push()
    drain.push()

    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(80)
    expect(onFire).toHaveBeenCalledTimes(1)

    drain.stop()
  })

  it('fires again after another idle period', () => {
    const onFire = vi.fn()
    const drain = startDebouncedDrain(30, onFire)

    drain.push()
    vi.advanceTimersByTime(80)
    expect(onFire).toHaveBeenCalledTimes(1)

    drain.push()
    vi.advanceTimersByTime(80)
    expect(onFire).toHaveBeenCalledTimes(2)

    drain.stop()
  })

  it('stops firing after stop is called', () => {
    const onFire = vi.fn()
    const drain = startDebouncedDrain(30, onFire)

    drain.stop()
    drain.push()
    vi.advanceTimersByTime(80)

    expect(onFire).not.toHaveBeenCalled()
  })
})
