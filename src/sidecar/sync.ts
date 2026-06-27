import { spawn } from 'node:child_process'
import { Effect } from 'effect'
import { fetchSemaphoreFor } from './fetch-semaphore'
import { normalizeRepoPath } from './git/instances'
import { FetchSkipped, GitError, type RepoNotOpen } from './git-errors'
import { requireOpen } from './op-helpers'
import { withRepoLock } from './repo-lock'
import { type RepoSessions, RepoSessionsLive, withSessionScope } from './repo-sessions'
import { capStderr, spawnGit } from './spawn'

type GitCmdResult = { ok: true } | { ok: false; message: string }

const PROMPTLESS_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

// `git fetch` forks transport helpers (e.g. ssh/remote-ext) that survive a signal aimed only at the
// git parent, so the child runs in its own process group and the finalizer signals the whole group.
function killFetchGroup(child: ReturnType<typeof spawn>): void {
  if (child.killed || child.pid === undefined) {
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill()
  }
}

function runFetch(key: string): Effect.Effect<GitCmdResult, never, RepoSessions> {
  return withSessionScope(
    key,
    Effect.gen(function* () {
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn('git', ['-c', 'fetch.writeCommitGraph=true', '-C', key, 'fetch', '--prune'], {
            stdio: ['ignore', 'ignore', 'pipe'],
            detached: true,
            env: PROMPTLESS_ENV
          })
        ),
        (proc) => Effect.sync(() => killFetchGroup(proc))
      )
      return yield* Effect.async<GitCmdResult>((resume) => {
        let stderr = ''
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => {
          stderr = capStderr(stderr + chunk)
        })
        child.on('error', (error: Error) => {
          resume(Effect.succeed({ ok: false, message: error.message }))
        })
        child.on('close', (code) => {
          resume(
            Effect.succeed(
              code === 0
                ? { ok: true }
                : { ok: false, message: stderr.trim() || `git fetch exited with code ${code}` }
            )
          )
        })
      })
    })
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
): Effect.Effect<void, RepoNotOpen | GitError | FetchSkipped, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    const semaphore = fetchSemaphoreFor(key)
    const outcome = yield* Effect.promise(() =>
      semaphore.withPermitsIfAvailable(() =>
        Effect.runPromise(runFetch(key).pipe(Effect.provide(RepoSessionsLive)))
      )
    )
    if (outcome === null) {
      return yield* Effect.fail(new FetchSkipped())
    }
    if (!outcome.ok) {
      return yield* Effect.fail(new GitError({ message: outcome.message }))
    }
  })
}

export function pushRepo(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
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

export function pullRepo(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
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
