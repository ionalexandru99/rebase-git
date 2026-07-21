import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tabResourceKey } from '@shared/repo-path'
import { Effect, ManagedRuntime } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { RepoLifecycleQueue, RepoLifecycleQueueLive } from '../repo-lifecycle-queue'

async function makeQueueRuntime() {
  const runtime = ManagedRuntime.make(RepoLifecycleQueueLive)
  const queue = await runtime.runPromise(RepoLifecycleQueue)
  return {
    run: <T>(key: string, task: () => Promise<T>) => queue.run(key, task),
    open: <T>(key: string, owner: number, task: () => Promise<T>) => queue.open(key, owner, task),
    close: <T>(key: string, owner: number, task: () => Promise<T>) =>
      queue.release(key, owner, task),
    disown: (key: string, owner: number) => queue.disown(key, owner),
    dispose: () => runtime.dispose()
  }
}

describe('repo lifecycle queue', () => {
  const cleanup: Array<() => void> = []

  afterEach(() => {
    while (cleanup.length > 0) {
      cleanup.pop()?.()
    }
  })

  it('does not start a reopen until the preceding close for the same owner settles', async () => {
    const queue = await makeQueueRuntime()
    let finishClose: () => void = () => {}
    const close = queue.run(
      '1:/repo',
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve
        })
    )
    let reopenStarted = false
    const reopen = queue.run('1:/repo', async () => {
      reopenStarted = true
    })

    await Promise.resolve()
    expect(reopenStarted).toBe(false)

    finishClose()
    await close
    await reopen
    expect(reopenStarted).toBe(true)

    await queue.dispose()
  })

  it('allows different tab/repo owners to proceed independently', async () => {
    const queue = await makeQueueRuntime()
    let finishFirst: () => void = () => {}
    const first = queue.run(
      '1:/repo-a',
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
        })
    )
    let secondStarted = false
    const second = queue.run('1:/repo-b', async () => {
      secondStarted = true
    })

    await second
    expect(secondStarted).toBe(true)

    finishFirst()
    await first

    await queue.dispose()
  })

  it('does not let a stale real-path close release a repo reopened through an alias', async () => {
    const queue = await makeQueueRuntime()
    const realPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-lifecycle-owner-'))
    const aliasPath = `${realPath}-alias`
    const otherPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-lifecycle-other-'))
    fs.symlinkSync(realPath, aliasPath)
    cleanup.push(() => fs.rmSync(aliasPath, { force: true }))
    cleanup.push(() => fs.rmSync(otherPath, { recursive: true, force: true }))
    cleanup.push(() => fs.rmSync(realPath, { recursive: true, force: true }))
    const realKey = tabResourceKey(1, realPath)
    const aliasKey = tabResourceKey(1, aliasPath)

    await queue.open(realKey, 1, async () => {})

    let finishReopen: () => void = () => {}
    const reopen = queue.open(
      aliasKey,
      2,
      () =>
        new Promise<void>((resolve) => {
          finishReopen = resolve
        })
    )
    let staleCloseRan = false
    const staleClose = queue.close(realKey, 1, async () => {
      staleCloseRan = true
    })
    let otherRepoOpened = false
    await queue.open(tabResourceKey(1, otherPath), 3, async () => {
      otherRepoOpened = true
    })

    expect(realKey).toBe(aliasKey)
    expect(otherRepoOpened).toBe(true)
    expect(staleCloseRan).toBe(false)

    finishReopen()
    await Promise.all([reopen, staleClose])

    expect(staleCloseRan).toBe(false)
    await queue.dispose()
  })

  it('restores the previous owner when a replacement owner is disowned', async () => {
    const queue = await makeQueueRuntime()
    const key = '1:/repo'
    await queue.open(key, 1, async () => {})
    await queue.open(key, 2, async () => {})

    await queue.disown(key, 2)
    let previousOwnerCloseRan = false
    await queue.close(key, 1, async () => {
      previousOwnerCloseRan = true
    })

    expect(previousOwnerCloseRan).toBe(true)
    await queue.dispose()
  })

  it('drains work already owned by the queue when its scope closes', async () => {
    const queue = await makeQueueRuntime()
    let finishClose: () => void = () => {}
    const close = queue.run(
      '1:/repo',
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve
        })
    )
    let reopenFinished = false
    const reopen = queue.run('1:/repo', async () => {
      reopenFinished = true
    })

    let scopeClosed = false
    const closing = queue.dispose().then(() => {
      scopeClosed = true
    })
    await Effect.runPromise(Effect.yieldNow())

    expect(scopeClosed).toBe(false)
    expect(reopenFinished).toBe(false)

    finishClose()
    await Promise.all([close, reopen, closing])

    expect(scopeClosed).toBe(true)
    expect(reopenFinished).toBe(true)
  })
})
