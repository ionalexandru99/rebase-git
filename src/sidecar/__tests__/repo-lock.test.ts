import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { repoLockCount, withRepoLock } from '../repo-lock'

describe('repo lock', () => {
  it('serializes work for the same repo', async () => {
    const order: string[] = []

    await Effect.runPromise(
      Effect.all(
        [
          withRepoLock(
            '/repo',
            Effect.gen(function* () {
              order.push('a:start')
              yield* Effect.sleep('10 millis')
              order.push('a:end')
            })
          ),
          withRepoLock(
            '/repo',
            Effect.sync(() => {
              order.push('b:start')
              order.push('b:end')
            })
          )
        ],
        { concurrency: 'unbounded' }
      )
    )

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    expect(repoLockCount()).toBe(0)
  })

  it('allows different repos to run independently', async () => {
    const order: string[] = []

    await Effect.runPromise(
      Effect.all(
        [
          withRepoLock(
            '/repo-a',
            Effect.gen(function* () {
              order.push('a:start')
              yield* Effect.sleep('10 millis')
              order.push('a:end')
            })
          ),
          withRepoLock(
            '/repo-b',
            Effect.sync(() => {
              order.push('b:start')
              order.push('b:end')
            })
          )
        ],
        { concurrency: 'unbounded' }
      )
    )

    expect(order.indexOf('b:start')).toBeLessThan(order.indexOf('a:end'))
    expect(repoLockCount()).toBe(0)
  })
})
