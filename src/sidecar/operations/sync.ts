import { Effect } from 'effect'
import { applyNonInteractiveGitEnv } from '../git/environment'
import { FetchSkipped, GitError, PushRejected, type RepoNotOpen } from '../git/errors'
import { normalizeRepoPath } from '../git/instances'
import { runGit, spawnGit, startGit } from '../git/spawn'
import { fetchSemaphoreFor } from '../session/fetch-semaphore'
import { withRepoLock } from '../session/lock'
import { type RepoSessions, RepoSessionsLive, withSessionScope } from '../session/sessions'
import { requireOpen } from './helpers'

type GitCmdResult = { ok: true } | { ok: false; message: string }

const promptlessEnv = (): NodeJS.ProcessEnv => applyNonInteractiveGitEnv({ ...process.env })

function runFetch(key: string): Effect.Effect<GitCmdResult, never, RepoSessions> {
  return withSessionScope(
    key,
    Effect.gen(function* () {
      const running = yield* Effect.acquireRelease(
        Effect.sync(() =>
          startGit(['-c', 'fetch.writeCommitGraph=true', '-C', key, 'fetch', '--prune'], {
            collectStdout: false,
            env: promptlessEnv()
          })
        ),
        (process) => Effect.promise(() => process.terminate()).pipe(Effect.orDie)
      )
      return yield* Effect.promise(() => running.result).pipe(
        Effect.map(
          ({ code, stderr }): GitCmdResult =>
            code === 0
              ? { ok: true }
              : { ok: false, message: stderr.trim() || `git fetch exited with code ${code}` }
        ),
        Effect.catchAll((error: Error) =>
          Effect.succeed({ ok: false as const, message: error.message })
        )
      )
    })
  )
}

function runGitCommand(key: string, args: string[]): Promise<GitCmdResult> {
  return spawnGit(['-C', key, ...args], {
    env: promptlessEnv()
  }).then<GitCmdResult, GitCmdResult>(
    ({ code, stdout, stderr }) =>
      code === 0
        ? { ok: true }
        : {
            ok: false,
            message:
              [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') ||
              `git ${args[0]} exited with code ${code}`
          },
    (error: Error) => ({ ok: false, message: error.message })
  )
}

function runGitStdout(key: string, args: string[]): Promise<string | null> {
  return runGit(['-C', key, ...args], { env: promptlessEnv() }).then(
    (stdout) => stdout.trim(),
    () => null
  )
}

const LOSS_FORMAT = '%h%x00%s'
const NUL = '\x00'

async function resolveRemoteTrackingRef(key: string): Promise<string | null> {
  const upstream = await runGitStdout(key, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])
  if (upstream) {
    return upstream
  }
  const branch = await runGitStdout(key, ['symbolic-ref', '--short', 'HEAD'])
  return branch ? `origin/${branch}` : null
}

async function fetchAndPreviewLoss(
  key: string,
  upstream: Upstream
): Promise<{ lostCommits: { sha: string; subject: string }[]; remoteSha?: string }> {
  return fetchSemaphoreFor(key).withPermits(async () => {
    await runGitCommand(key, ['fetch', '--prune', upstream.remote])
    const remoteRef = await resolveRemoteTrackingRef(key)
    if (remoteRef === null) {
      return { lostCommits: [] }
    }
    const remoteSha = await runGitStdout(key, ['rev-parse', remoteRef])
    const logOutput = await runGitStdout(key, [
      'log',
      `--format=${LOSS_FORMAT}`,
      `HEAD..${remoteRef}`
    ])
    const lostCommits = (logOutput ?? '')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [sha, subject] = line.split(NUL)
        return { sha, subject: subject ?? '' }
      })
    return { lostCommits, remoteSha: remoteSha ?? undefined }
  })
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

export type PushForce = 'with-lease' | 'overwrite'

type RejectionReason = 'non-fast-forward' | 'lease-stale' | 'remote-moved'

function classifyRejection(stderr: string): RejectionReason | null {
  if (stderr.includes('(stale info)')) {
    return 'lease-stale'
  }
  if (stderr.includes('(remote ref updated since checkout)')) {
    return 'remote-moved'
  }
  if (stderr.includes('(fetch first)') || stderr.includes('(non-fast-forward)')) {
    return 'non-fast-forward'
  }
  return null
}

interface Upstream {
  remote: string
  remoteRef: string
  hasUpstream: boolean
}

async function resolveUpstream(key: string): Promise<Upstream | null> {
  const branch = await runGitStdout(key, ['symbolic-ref', '--short', 'HEAD'])
  if (branch === null) {
    return null
  }
  const remote = await runGitStdout(key, ['config', `branch.${branch}.remote`])
  const mergeRef = await runGitStdout(key, ['config', `branch.${branch}.merge`])
  if (remote && mergeRef) {
    return { remote, remoteRef: mergeRef.replace(/^refs\/heads\//, ''), hasUpstream: true }
  }
  return { remote: 'origin', remoteRef: branch, hasUpstream: false }
}

function buildPushArgs(
  force: PushForce | undefined,
  upstream: Upstream,
  expectedRemoteSha: string | undefined
): string[] {
  const remoteRef = `refs/heads/${upstream.remoteRef}`
  if (force === 'overwrite') {
    const args = [
      'push',
      '--porcelain',
      `--force-with-lease=${remoteRef}:${expectedRemoteSha ?? ''}`
    ]
    if (!upstream.hasUpstream) {
      args.push('--set-upstream')
    }
    args.push(upstream.remote, `HEAD:${remoteRef}`)
    return args
  }
  const args = ['push', '--porcelain']
  if (force === 'with-lease') {
    args.push(`--force-with-lease=${remoteRef}`, '--force-if-includes')
  }
  if (!upstream.hasUpstream) {
    args.push('--set-upstream')
  }
  args.push(upstream.remote, `HEAD:${remoteRef}`)
  return args
}

export function pushRepo(
  repoPath: string,
  force?: PushForce,
  expectedRemoteSha?: string
): Effect.Effect<void, RepoNotOpen | GitError | PushRejected, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    if (force === 'overwrite' && expectedRemoteSha === undefined) {
      return yield* Effect.fail(
        new GitError({ message: 'overwrite requires an expected remote SHA' })
      )
    }
    yield* withRepoLock(
      key,
      Effect.gen(function* () {
        const upstream = yield* Effect.promise(() => resolveUpstream(key))
        if (upstream === null) {
          return yield* Effect.fail(new GitError({ message: 'cannot push a detached HEAD' }))
        }
        const pushArgs = buildPushArgs(force, upstream, expectedRemoteSha)
        const result = yield* Effect.promise(() => runGitCommand(key, pushArgs))
        if (result.ok) {
          return
        }
        const reason = classifyRejection(result.message)
        if (reason === null) {
          return yield* Effect.fail(new GitError({ message: result.message }))
        }
        if (reason === 'non-fast-forward') {
          return yield* Effect.fail(new PushRejected({ reason, lostCommits: [] }))
        }
        const preview = yield* Effect.promise(() => fetchAndPreviewLoss(key, upstream))
        return yield* Effect.fail(
          new PushRejected({
            reason,
            lostCommits: preview.lostCommits,
            remoteSha: preview.remoteSha
          })
        )
      })
    )
  })
}

export function pullRepo(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    yield* withRepoLock(
      key,
      Effect.promise(() =>
        fetchSemaphoreFor(key).withPermits(() =>
          runGitCommand(key, ['-c', 'pull.rebase=false', 'pull', '--ff-only'])
        )
      ).pipe(
        Effect.flatMap((result) =>
          result.ok ? Effect.void : Effect.fail(new GitError({ message: result.message }))
        )
      )
    )
  })
}
