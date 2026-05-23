import { Effect, Fiber, Queue } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { ignoreWorkingTree, startDebouncedDrain } from './repoWatcher'

async function tick(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

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

describe('startDebouncedDrain', () => {
  it('fires once after the queue goes idle', async () => {
    const queue = Effect.runSync(Queue.unbounded<void>())
    const onFire = vi.fn()
    const fiber = startDebouncedDrain(queue, 30, onFire)

    Effect.runSync(Queue.offer(queue, undefined))
    Effect.runSync(Queue.offer(queue, undefined))
    Effect.runSync(Queue.offer(queue, undefined))

    expect(onFire).not.toHaveBeenCalled()
    await tick(80)
    expect(onFire).toHaveBeenCalledTimes(1)

    await Effect.runPromise(Fiber.interrupt(fiber))
    Effect.runSync(Queue.shutdown(queue))
  })

  it('fires again after another idle period', async () => {
    const queue = Effect.runSync(Queue.unbounded<void>())
    const onFire = vi.fn()
    const fiber = startDebouncedDrain(queue, 30, onFire)

    Effect.runSync(Queue.offer(queue, undefined))
    await tick(80)
    expect(onFire).toHaveBeenCalledTimes(1)

    Effect.runSync(Queue.offer(queue, undefined))
    await tick(80)
    expect(onFire).toHaveBeenCalledTimes(2)

    await Effect.runPromise(Fiber.interrupt(fiber))
    Effect.runSync(Queue.shutdown(queue))
  })

  it('stops firing after the fiber is interrupted', async () => {
    const queue = Effect.runSync(Queue.unbounded<void>())
    const onFire = vi.fn()
    const fiber = startDebouncedDrain(queue, 30, onFire)

    await Effect.runPromise(Fiber.interrupt(fiber))
    Effect.runSync(Queue.offer(queue, undefined))
    await tick(80)

    expect(onFire).not.toHaveBeenCalled()
    Effect.runSync(Queue.shutdown(queue))
  })
})
