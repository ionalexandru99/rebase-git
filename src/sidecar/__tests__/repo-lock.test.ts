import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'
import { repoLockCount, withRepoLock } from '../repo-lock'
import { runWithRequestChildren, spawnGit, startGit } from '../spawn'
import { createHangingGit, killIfAlive, processAlive, waitUntil } from './hanging-git'

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

  it('kills spawned git children and retains the permit until they exit on timeout', async () => {
    const fake = createHangingGit('rebase-lock-git-')
    let descendantAliveWhenNextOwnerStarted = true

    try {
      const timedOutPromise = Effect.runPromise(
        Effect.either(
          withRepoLock(
            fake.repoDir,
            Effect.promise(() => spawnGit(fake.args, { env: fake.env, collectStdout: false })),
            { timeoutMs: 500 }
          )
        )
      )
      await waitUntil(() => fake.childPid() !== undefined)
      const descendantPid = fake.childPid()
      const nextOwnerPromise = Effect.runPromise(
        withRepoLock(
          fake.repoDir,
          Effect.sync(() => {
            descendantAliveWhenNextOwnerStarted = processAlive(descendantPid)
          })
        )
      )
      const [timedOut] = await Promise.all([timedOutPromise, nextOwnerPromise])

      expect(timedOut._tag).toBe('Left')
      expect(descendantAliveWhenNextOwnerStarted).toBe(false)
      expect(repoLockCount()).toBe(0)
    } finally {
      killIfAlive(fake.childPid())
      fake.cleanup()
    }
  }, 30_000)

  it('keeps concurrent request children outside a timed-out repo operation', async () => {
    const mutationGit = createHangingGit('rebase-lock-mutation-')
    const backgroundGit = createHangingGit('rebase-lock-background-')
    const lockKey = mutationGit.repoDir
    const mutationController = new AbortController()
    const backgroundController = new AbortController()
    let backgroundRequest: Promise<void> | undefined

    try {
      const mutation = runWithRequestChildren(mutationController.signal, () =>
        Effect.runPromise(
          Effect.either(
            withRepoLock(
              lockKey,
              Effect.promise(() =>
                spawnGit(mutationGit.args, { env: mutationGit.env, collectStdout: false })
              ),
              { timeoutMs: 500 }
            )
          )
        )
      )
      await waitUntil(() => mutationGit.childPid() !== undefined)
      const mutationDescendant = mutationGit.childPid()

      backgroundRequest = runWithRequestChildren(backgroundController.signal, async () => {
        await startGit(backgroundGit.args, {
          env: backgroundGit.env,
          collectStdout: false
        }).result
      })
      await waitUntil(() => backgroundGit.childPid() !== undefined)
      const backgroundDescendant = backgroundGit.childPid()

      let backgroundRunningWhenNextOwnerStarted = false
      let mutationDescendantAliveWhenNextOwnerStarted = true
      const nextOwner = Effect.runPromise(
        withRepoLock(
          lockKey,
          Effect.sync(() => {
            backgroundRunningWhenNextOwnerStarted = processAlive(backgroundDescendant)
            mutationDescendantAliveWhenNextOwnerStarted = processAlive(mutationDescendant)
          })
        )
      )
      const mutationResult = await mutation
      await nextOwner

      expect(mutationResult._tag).toBe('Left')
      expect(mutationDescendantAliveWhenNextOwnerStarted).toBe(false)
      expect(backgroundRunningWhenNextOwnerStarted).toBe(true)

      backgroundController.abort()
      await backgroundRequest
      await waitUntil(() => !processAlive(backgroundDescendant))
    } finally {
      mutationController.abort()
      backgroundController.abort()
      await backgroundRequest?.catch(() => {})
      killIfAlive(mutationGit.childPid())
      killIfAlive(backgroundGit.childPid())
      mutationGit.cleanup()
      backgroundGit.cleanup()
    }
  }, 30_000)

  it('retains the permit through cancellation finalizers before the next owner starts', async () => {
    let cancelledWorkExited = false
    const first = Effect.runFork(
      withRepoLock(
        '/cancelled-repo',
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sleep('30 millis').pipe(
              Effect.andThen(
                Effect.sync(() => {
                  cancelledWorkExited = true
                })
              )
            )
          )
        )
      )
    )
    await waitUntil(() => repoLockCount() === 1)

    const interruption = Effect.runPromise(Fiber.interrupt(first))
    let stateWhenNextOwnerStarted = false
    const nextOwner = Effect.runPromise(
      withRepoLock(
        '/cancelled-repo',
        Effect.sync(() => {
          stateWhenNextOwnerStarted = cancelledWorkExited
        })
      )
    )

    await Promise.all([interruption, nextOwner])
    expect(stateWhenNextOwnerStarted).toBe(true)
    expect(repoLockCount()).toBe(0)
  })
})
