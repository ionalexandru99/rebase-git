import { Deferred, Effect, Fiber } from 'effect'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type GitError, RepoNotOpen } from '../../git/errors'
import { normalizeRepoPath } from '../../git/instances'
import { runWithRequestChildren, startGit } from '../../git/spawn'
import { closeRepo, fetchRepo, openRepo } from '../../operations/index'
import {
  createHangingRemote,
  killIfAlive,
  processAlive,
  waitUntil
} from '../../test-support/hanging-git'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { repoLockCount, repoSemaphoreSize, withRepoLock } from '../lock'
import { requireGit } from '../sessions'

let repo: RepoFixture

const COMMIT_MESSAGE = 'commit spared by close'

async function prepareStagedRepo(): Promise<SimpleGit> {
  const git = await runOp(openRepo(repo.path).pipe(Effect.zipRight(requireGit(repo.path))))
  repo.write('tracked.txt', 'mutated\n')
  await git.add(['tracked.txt'])
  return git
}

function withSparedCommit<E, R>(
  git: SimpleGit,
  key: string,
  whileHeld: Effect.Effect<void, E, R>
): Effect.Effect<void, E | GitError, R> {
  return Effect.gen(function* () {
    const acquired = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()

    const mutation = withRepoLock(
      key,
      Effect.gen(function* () {
        yield* Deferred.succeed(acquired, undefined)
        yield* Deferred.await(gate)
        yield* Effect.promise(() => git.commit(COMMIT_MESSAGE))
      })
    )

    const fiber = yield* Effect.fork(mutation)
    yield* Deferred.await(acquired)
    yield* whileHeld
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(fiber)
  })
}

beforeEach(() => {
  repo = createRepoFixture({ prefix: 'rebase-close-spare-' })
  repo.write('tracked.txt', 'base\n')
  repo.git('add', '.')
  repo.commitStaged('base')
})

afterEach(() => {
  repo.cleanup()
})

describe('closing a repo session spares an in-flight mutation (ADR-0002)', () => {
  it('runs the mutation to completion and reclaims its repo lock after it settles', async () => {
    const key = normalizeRepoPath(repo.path)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()

    await runOp(withSparedCommit(git, key, closeRepo(repo.path)))

    expect(repo.git('log', '--format=%s')).toContain(COMMIT_MESSAGE)
    expect(repoLockCount()).toBe(0)
    expect(repoSemaphoreSize()).toBe(baseline)
  })

  it('fails requireGit with RepoNotOpen and defers reclaim while the spared mutation is mid-flight', async () => {
    const key = normalizeRepoPath(repo.path)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()

    const whileHeld = Effect.gen(function* () {
      yield* closeRepo(repo.path)
      const stillOpen = yield* Effect.either(requireGit(repo.path))
      expect(stillOpen._tag).toBe('Left')
      expect((stillOpen as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
      expect(repoSemaphoreSize()).toBe(baseline + 1)
    })

    await runOp(withSparedCommit(git, key, whileHeld))

    expect(repoSemaphoreSize()).toBe(baseline)
  })

  it('force-kills an in-flight background fetch on close while sparing the mutation', async () => {
    const key = normalizeRepoPath(repo.path)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()
    const hangingRemote = createHangingRemote('rebase-close-spare-remote-')

    try {
      repo.git('remote', 'add', 'origin', hangingRemote.remoteDir)
      repo.git('config', 'remote.origin.uploadpack', hangingRemote.uploadPack)

      const fetching = runOp(fetchRepo(repo.path)).then(
        () => 'resolved',
        () => 'rejected'
      )
      await waitUntil(() => hangingRemote.childPid() !== undefined)
      const transportPid = hangingRemote.childPid()

      await runOp(withSparedCommit(git, key, closeRepo(repo.path)))

      expect(processAlive(transportPid)).toBe(false)
      expect(await fetching).toBe('rejected')
      expect(repo.git('log', '--format=%s')).toContain(COMMIT_MESSAGE)
      expect(repoLockCount()).toBe(0)
      expect(repoSemaphoreSize()).toBe(baseline)
    } finally {
      killIfAlive(hangingRemote.childPid())
      hangingRemote.cleanup()
    }
  }, 30_000)

  it('retains the in-flight lock for a session reopened before the spared mutation settles', async () => {
    const key = normalizeRepoPath(repo.path)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()

    const reopenWhileHeld = closeRepo(repo.path).pipe(
      Effect.zipRight(openRepo(repo.path)),
      Effect.asVoid
    )
    await runOp(withSparedCommit(git, key, reopenWhileHeld))

    expect(repoSemaphoreSize()).toBe(baseline + 1)

    await runOp(closeRepo(repo.path))
    expect(repoSemaphoreSize()).toBe(baseline)
  })
})

describe('closing a repo session cancels in-flight reads', () => {
  it('awaits the read process tree before close completes', async () => {
    await runOp(openRepo(repo.path))
    const hangingRemote = createHangingRemote('rebase-close-read-')
    const controller = new AbortController()

    try {
      const reading = runWithRequestChildren(controller.signal, async () => {
        const running = startGit(
          [
            '-C',
            repo.path,
            'fetch',
            '--upload-pack',
            hangingRemote.uploadPack,
            hangingRemote.remoteDir
          ],
          { collectStdout: false }
        )
        return running.result
      })
      await waitUntil(() => hangingRemote.childPid() !== undefined)
      const transportPid = hangingRemote.childPid()

      await runOp(closeRepo(repo.path))

      expect(processAlive(transportPid)).toBe(false)
      await reading
    } finally {
      controller.abort()
      killIfAlive(hangingRemote.childPid())
      hangingRemote.cleanup()
    }
  }, 30_000)
})
