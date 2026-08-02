import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeRepoPath } from '../../git/instances'
import { closeRepo, openRepo } from '../../operations/index'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { fetchSemaphoreFor } from '../fetch-semaphore'
import { repoLockCount, withRepoLock } from '../lock'

let repo: RepoFixture

beforeAll(() => {
  repo = createRepoFixture({ prefix: 'rebase-reclaim-test-' })
  repo.write('tracked.txt', 'base\n')
  repo.git('add', '.')
  repo.commitStaged('base')
})

afterAll(() => {
  repo.cleanup()
})

describe('repo session reclaims its per-repo semaphore entries on close', () => {
  it('hands a fresh fetch semaphore after close and reopen', async () => {
    const key = normalizeRepoPath(repo.path)

    await runOp(openRepo(repo.path))
    const before = fetchSemaphoreFor(key)

    await runOp(closeRepo(repo.path))

    await runOp(openRepo(repo.path))
    const after = fetchSemaphoreFor(key)

    expect(after).not.toBe(before)

    await runOp(closeRepo(repo.path))
  })

  it('reuses an active fetch semaphore across close and reopen', async () => {
    const key = normalizeRepoPath(repo.path)
    await runOp(openRepo(repo.path))
    const before = fetchSemaphoreFor(key)
    let releaseWork: (() => void) | undefined
    let startedResolve: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve
    })
    const held = before.withPermits(
      () =>
        new Promise<void>((resolve) => {
          releaseWork = resolve
          startedResolve?.()
        })
    )
    await started

    await runOp(closeRepo(repo.path))
    await runOp(openRepo(repo.path))
    const after = fetchSemaphoreFor(key)

    expect(after).toBe(before)
    releaseWork?.()
    await held
    await runOp(closeRepo(repo.path))
  })

  it('leaves the repo lock immediately re-acquirable and still serializing after close/reopen', async () => {
    const key = normalizeRepoPath(repo.path)

    await runOp(openRepo(repo.path))
    await runOp(closeRepo(repo.path))

    expect(repoLockCount()).toBe(0)

    await runOp(openRepo(repo.path))

    const order: string[] = []
    await runOp(
      Effect.all(
        [
          withRepoLock(
            key,
            Effect.gen(function* () {
              order.push('first:start')
              yield* Effect.sleep('10 millis')
              order.push('first:end')
            })
          ),
          withRepoLock(
            key,
            Effect.sync(() => {
              order.push('second:start')
              order.push('second:end')
            })
          )
        ],
        { concurrency: 'unbounded' }
      )
    )

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    expect(repoLockCount()).toBe(0)

    await runOp(closeRepo(repo.path))
  })
})
