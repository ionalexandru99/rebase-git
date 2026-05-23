import { Deferred, Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { fetchSemaphoreFor } from '../state'

describe('fetchSemaphoreFor', () => {
  it('returns the same semaphore for the same repo path', () => {
    const a = fetchSemaphoreFor('/test/repo-a')
    const b = fetchSemaphoreFor('/test/repo-a')
    expect(a).toBe(b)
  })

  it('returns independent semaphores for different repo paths', async () => {
    const a = fetchSemaphoreFor('/test/repo-a-iso')
    const b = fetchSemaphoreFor('/test/repo-b-iso')

    const held = await Effect.runPromise(Deferred.make<void>())
    const acquired = await Effect.runPromise(Deferred.make<void>())
    const aHeld = Effect.runPromise(
      a.withPermits(1)(
        Effect.zipRight(Deferred.succeed(acquired, undefined), Deferred.await(held))
      )
    )
    await Effect.runPromise(Deferred.await(acquired))

    const bResult = await Effect.runPromise(b.withPermitsIfAvailable(1)(Effect.succeed('ok')))
    expect(Option.isSome(bResult)).toBe(true)

    await Effect.runPromise(Deferred.succeed(held, undefined))
    await aHeld
  })

  it('refuses a second concurrent permit and skips with None', async () => {
    const semaphore = fetchSemaphoreFor('/test/repo-skip')
    const held = await Effect.runPromise(Deferred.make<void>())
    const acquired = await Effect.runPromise(Deferred.make<void>())
    const first = Effect.runPromise(
      semaphore.withPermits(1)(
        Effect.zipRight(Deferred.succeed(acquired, undefined), Deferred.await(held))
      )
    )
    await Effect.runPromise(Deferred.await(acquired))

    const second = await Effect.runPromise(
      semaphore.withPermitsIfAvailable(1)(Effect.succeed('second'))
    )
    expect(Option.isNone(second)).toBe(true)

    await Effect.runPromise(Deferred.succeed(held, undefined))
    await first
  })

  it('lets a subsequent caller proceed after the first releases', async () => {
    const semaphore = fetchSemaphoreFor('/test/repo-release')
    await Effect.runPromise(semaphore.withPermits(1)(Effect.succeed('first')))
    const after = await Effect.runPromise(
      semaphore.withPermitsIfAvailable(1)(Effect.succeed('after'))
    )
    expect(Option.isSome(after)).toBe(true)
  })
})
