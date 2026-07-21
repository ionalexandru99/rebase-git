import { ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  FetchSemaphores,
  FetchSemaphoresLive,
  fetchSemaphoreFor,
  fetchSemaphoreSize,
  releaseFetchSemaphore
} from '../fetch-semaphore'

describe('fetchSemaphoreFor', () => {
  it('returns the same semaphore for the same repo path', () => {
    const a = fetchSemaphoreFor('/test/repo-a')
    const b = fetchSemaphoreFor('/test/repo-a')
    expect(a).toBe(b)
  })

  it('returns independent semaphores for different repo paths', async () => {
    const a = fetchSemaphoreFor('/test/repo-a-iso')
    const b = fetchSemaphoreFor('/test/repo-b-iso')

    let releaseA: (() => void) | undefined
    const holdA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const aHeld = a.withPermits(async () => {
      await holdA
      return 'a'
    })

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })

    const bResult = await b.withPermitsIfAvailable(async () => 'ok')
    expect(bResult).toBe('ok')

    releaseA?.()
    await aHeld
  })

  it('refuses a second concurrent permit and skips with null', async () => {
    const semaphore = fetchSemaphoreFor('/test/repo-skip')
    let releaseFirst: (() => void) | undefined
    const hold = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = semaphore.withPermits(async () => {
      await hold
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const second = await semaphore.withPermitsIfAvailable(async () => 'second')
    expect(second).toBeNull()

    releaseFirst?.()
    await first
  })

  it('lets a subsequent caller proceed after the first releases', async () => {
    const semaphore = fetchSemaphoreFor('/test/repo-release')
    await semaphore.withPermits(async () => 'first')
    const after = await semaphore.withPermitsIfAvailable(async () => 'after')
    expect(after).toBe('after')
  })
})

describe('releaseFetchSemaphore', () => {
  it('removes the entry so it does not grow unbounded across repo open/close cycles', () => {
    fetchSemaphoreFor('/test/repo-leak-1')
    fetchSemaphoreFor('/test/repo-leak-2')
    const before = fetchSemaphoreSize()

    expect(releaseFetchSemaphore('/test/repo-leak-1')).toBe(true)

    expect(fetchSemaphoreSize()).toBe(before - 1)
  })

  it('returns false when the entry does not exist', () => {
    expect(releaseFetchSemaphore('/test/never-created')).toBe(false)
  })

  it('produces a fresh semaphore on the next call after release', () => {
    const first = fetchSemaphoreFor('/test/repo-fresh')
    releaseFetchSemaphore('/test/repo-fresh')
    const second = fetchSemaphoreFor('/test/repo-fresh')
    expect(second).not.toBe(first)
  })
})

describe('fetch semaphore scope', () => {
  it('waits for owned work before scope finalization completes', async () => {
    const runtime = ManagedRuntime.make(FetchSemaphoresLive)
    const registry = runtime.runSync(FetchSemaphores)
    const semaphore = registry.forRepo('/test/scoped-repo')
    let releaseWork: () => void = () => {}
    const work = semaphore.withPermits(
      () =>
        new Promise<void>((resolve) => {
          releaseWork = resolve
        })
    )
    await Promise.resolve()

    let finalized = false
    const finalization = runtime.dispose().then(() => {
      finalized = true
    })
    await Promise.resolve()

    expect(finalized).toBe(false)

    releaseWork()
    await Promise.all([work, finalization])

    expect(finalized).toBe(true)
  })
})
