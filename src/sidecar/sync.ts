import type { ChildProcess } from 'node:child_process'
import { Effect } from 'effect'
import { fetchSemaphoreFor } from './fetch-semaphore'
import { normalizeRepoPath } from './git/instances'
import { FetchSkipped, GitError, type RepoNotOpen } from './git-errors'
import { requireOpen } from './op-helpers'
import { withRepoLock } from './repo-lock'
import { spawnGit } from './spawn'
import { activeFetches } from './state'

type GitCmdResult = { ok: true } | { ok: false; message: string }

const PROMPTLESS_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

function runFetch(key: string): Promise<GitCmdResult> {
  let child: ChildProcess | undefined
  const releaseActive = () => {
    if (child && activeFetches.get(key) === child) {
      activeFetches.delete(key)
    }
  }
  return spawnGit(['-c', 'fetch.writeCommitGraph=true', '-C', key, 'fetch', '--prune'], {
    env: PROMPTLESS_ENV,
    collectStdout: false,
    onSpawn: (proc) => {
      child = proc
      activeFetches.set(key, proc)
    }
  }).then<GitCmdResult, GitCmdResult>(
    ({ code, stderr }) => {
      releaseActive()
      return code === 0
        ? { ok: true }
        : { ok: false, message: stderr.trim() || `git fetch exited with code ${code}` }
    },
    (error: Error) => {
      releaseActive()
      return { ok: false, message: error.message }
    }
  )
}

function runGitCommand(key: string, args: string[]): Promise<GitCmdResult> {
  return spawnGit(['-C', key, ...args], {
    env: PROMPTLESS_ENV,
    collectStdout: false
  }).then<GitCmdResult, GitCmdResult>(
    ({ code, stderr }) =>
      code === 0
        ? { ok: true }
        : { ok: false, message: stderr.trim() || `git ${args[0]} exited with code ${code}` },
    (error: Error) => ({ ok: false, message: error.message })
  )
}

export function fetchRepo(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError | FetchSkipped> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    const semaphore = fetchSemaphoreFor(key)
    const outcome = yield* Effect.promise(() =>
      semaphore.withPermitsIfAvailable(() => runFetch(key))
    )
    if (outcome === null) {
      return yield* Effect.fail(new FetchSkipped())
    }
    if (!outcome.ok) {
      return yield* Effect.fail(new GitError({ message: outcome.message }))
    }
  })
}

export function pushRepo(repoPath: string): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    yield* withRepoLock(
      key,
      Effect.gen(function* () {
        const upstream = yield* Effect.promise(() =>
          runGitCommand(key, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
        )
        const pushArgs = upstream.ok ? ['push'] : ['push', '--set-upstream', 'origin', 'HEAD']
        const result = yield* Effect.promise(() => runGitCommand(key, pushArgs))
        if (!result.ok) {
          return yield* Effect.fail(new GitError({ message: result.message }))
        }
      }),
      { timeoutMs: null }
    )
  })
}

export function pullRepo(repoPath: string): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    // `git pull` fetches, so it must hold the fetch semaphore that standalone fetchRepo uses —
    // otherwise a concurrent fetch and this pull race to write FETCH_HEAD/remote refs and one
    // dies on a git lock. withPermits waits for an in-flight fetch instead of skipping.
    yield* withRepoLock(
      key,
      Effect.promise(() =>
        fetchSemaphoreFor(key).withPermits(() => runGitCommand(key, ['pull', '--ff-only']))
      ).pipe(
        Effect.flatMap((result) =>
          result.ok ? Effect.void : Effect.fail(new GitError({ message: result.message }))
        )
      ),
      { timeoutMs: null }
    )
  })
}
