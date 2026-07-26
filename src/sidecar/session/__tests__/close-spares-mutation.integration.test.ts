import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Deferred, Effect, Fiber } from 'effect'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type GitError, RepoNotOpen } from '../../git/errors'
import { normalizeRepoPath } from '../../git/instances'
import { closeRepo, fetchRepo, openRepo } from '../../operations/index'
import {
  createHangingRemote,
  killIfAlive,
  processAlive,
  waitUntil
} from '../../test-support/hanging-git'
import { runOp } from '../../test-support/run-op'
import { repoLockCount, repoSemaphoreSize, withRepoLock } from '../lock'
import { requireGit } from '../sessions'

let baseDir: string
let repoDir: string

const COMMIT_MESSAGE = 'commit spared by close'

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

async function prepareStagedRepo(): Promise<SimpleGit> {
  const git = await runOp(openRepo(repoDir).pipe(Effect.zipRight(requireGit(repoDir))))
  fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'mutated\n')
  await git.add(['tracked.txt'])
  return git
}

// Drives a commit that holds the repo lock through `withRepoLock` — mirroring the real `commit`
// op's capture-git-then-lock shape — and runs `whileHeld` after the lock is held but before the
// commit finishes, so the race with whatever `whileHeld` does (close, reopen, fetch-kill) is
// deterministic rather than timing-dependent.
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
  baseDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-close-spare-')))
  repoDir = path.join(baseDir, 'repo')
  fs.mkdirSync(repoDir)
  gitIn(repoDir, 'init', '-b', 'main')
  gitIn(repoDir, 'config', 'user.email', 'test@example.com')
  gitIn(repoDir, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'base\n')
  gitIn(repoDir, 'add', '.')
  gitIn(repoDir, 'commit', '-m', 'base')
})

afterEach(() => {
  // Closing kills the session's commit-graph write mid-flight, and Windows keeps a killed process's
  // files undeletable for a moment after it exits — long enough to fail this rm with EPERM.
  fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
})

describe('closing a repo session spares an in-flight mutation (ADR-0002)', () => {
  it('runs the mutation to completion and reclaims its repo lock after it settles', async () => {
    const key = normalizeRepoPath(repoDir)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()

    await runOp(withSparedCommit(git, key, closeRepo(repoDir)))

    expect(gitIn(repoDir, 'log', '--format=%s')).toContain(COMMIT_MESSAGE)
    expect(repoLockCount()).toBe(0)
    expect(repoSemaphoreSize()).toBe(baseline)
  })

  it('fails requireGit with RepoNotOpen and defers reclaim while the spared mutation is mid-flight', async () => {
    const key = normalizeRepoPath(repoDir)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()

    const whileHeld = Effect.gen(function* () {
      yield* closeRepo(repoDir)
      const stillOpen = yield* Effect.either(requireGit(repoDir))
      expect(stillOpen._tag).toBe('Left')
      expect((stillOpen as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
      expect(repoSemaphoreSize()).toBe(baseline + 1)
    })

    await runOp(withSparedCommit(git, key, whileHeld))

    expect(repoSemaphoreSize()).toBe(baseline)
  })

  it('force-kills an in-flight background fetch on close while sparing the mutation', async () => {
    const key = normalizeRepoPath(repoDir)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()
    const hangingRemote = createHangingRemote('rebase-close-spare-remote-')

    try {
      gitIn(repoDir, 'remote', 'add', 'origin', hangingRemote.remoteDir)
      gitIn(repoDir, 'config', 'remote.origin.uploadpack', hangingRemote.uploadPack)

      const fetching = runOp(fetchRepo(repoDir)).then(
        () => 'resolved',
        () => 'rejected'
      )
      await waitUntil(() => hangingRemote.childPid() !== undefined)
      const transportPid = hangingRemote.childPid()

      await runOp(withSparedCommit(git, key, closeRepo(repoDir)))

      expect(processAlive(transportPid)).toBe(false)
      expect(await fetching).toBe('rejected')
      expect(gitIn(repoDir, 'log', '--format=%s')).toContain(COMMIT_MESSAGE)
      expect(repoLockCount()).toBe(0)
      expect(repoSemaphoreSize()).toBe(baseline)
    } finally {
      killIfAlive(hangingRemote.childPid())
      hangingRemote.cleanup()
    }
  }, 30_000)

  it('retains the in-flight lock for a session reopened before the spared mutation settles', async () => {
    const key = normalizeRepoPath(repoDir)
    const baseline = repoSemaphoreSize()
    const git = await prepareStagedRepo()

    const reopenWhileHeld = closeRepo(repoDir).pipe(
      Effect.zipRight(openRepo(repoDir)),
      Effect.asVoid
    )
    await runOp(withSparedCommit(git, key, reopenWhileHeld))

    expect(repoSemaphoreSize()).toBe(baseline + 1)

    await runOp(closeRepo(repoDir))
    expect(repoSemaphoreSize()).toBe(baseline)
  })
})
