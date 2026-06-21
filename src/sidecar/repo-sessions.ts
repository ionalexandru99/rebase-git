import { spawn } from 'node:child_process'
import { Context, Effect, ExecutionStrategy, Exit, Layer, Scope } from 'effect'
import type { SimpleGit } from 'simple-git'
import { releaseFetchSemaphore } from './fetch-semaphore'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import { type GitError, gitError, NotARepo, RepoNotOpen } from './git-errors'
import { releaseRepoSemaphore } from './repo-lock'

export interface RepoSessionsService {
  // Session creation only: get-or-create the instance, reject a non-repo, ensure the commit graph.
  // The UI's first reads (remotes, default branch, gitdirs) live in the openRepo operation.
  open(repoPath: string): Effect.Effect<SimpleGit, NotARepo | GitError>
  close(repoPath: string): Effect.Effect<void>
  requireGit(repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen>
  requireOpen(repoPath: string): Effect.Effect<void, RepoNotOpen>
  isCommitGraphTracked(repoPath: string): boolean
  // Run a scoped effect bound to the repo's session: its finalizers run when the scoped effect
  // settles, and are force-run if the session closes first (the child scope is forked from the
  // session's scope). Used by the cancel-safe background workers to register kill-on-close cleanup.
  withSessionScope<A, E>(
    repoPath: string,
    effect: Effect.Effect<A, E, Scope.Scope>
  ): Effect.Effect<A, E>
}

function makeRepoSessions(): RepoSessionsService {
  const instances = new Map<string, SimpleGit>()
  const scopes = new Map<string, Scope.CloseableScope>()
  const commitGraphWritten = new Set<string>()

  // Forks a child Scope from the session's scope so the effect's finalizers run when it settles and
  // are force-run if the session closes first; falls back to a self-contained scope when no session
  // is open. Shared by withSessionScope and the background commit-graph write.
  function runOnSessionScope<A, E>(
    key: string,
    effect: Effect.Effect<A, E, Scope.Scope>
  ): Effect.Effect<A, E> {
    return Effect.gen(function* () {
      const parent = scopes.get(key)
      if (!parent) {
        return yield* Effect.scoped(effect)
      }
      const child = yield* Scope.fork(parent, ExecutionStrategy.sequential)
      return yield* Scope.extend(effect, child).pipe(
        Effect.onExit((exit) => Scope.close(child, exit))
      )
    })
  }

  // Generation numbers from a commit-graph file make `git log --topo-order` stream incrementally
  // instead of walking the full history before the first row. The write child is registered on the
  // session scope, so closing the repo kills it; the marker is cleared on close so reopen retries.
  function ensureCommitGraph(key: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (commitGraphWritten.has(key)) {
        return Effect.void
      }
      commitGraphWritten.add(key)
      const write = runOnSessionScope(
        key,
        Effect.gen(function* () {
          const proc = yield* Effect.acquireRelease(
            Effect.sync(() =>
              spawn('git', ['-C', key, 'commit-graph', 'write', '--reachable', '--split'], {
                stdio: 'ignore',
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
              })
            ),
            (child) =>
              Effect.sync(() => {
                if (!child.killed) {
                  child.kill()
                }
              })
          )
          yield* Effect.async<void>((resume) => {
            proc.on('close', () => resume(Effect.void))
            proc.on('error', () => resume(Effect.void))
          })
        })
      )
      return Effect.forkDaemon(write).pipe(Effect.asVoid)
    })
  }

  return {
    open: (repoPath) =>
      Effect.gen(function* () {
        const key = normalizeRepoPath(repoPath)
        const git = getOrCreateGit(instances, key)
        const isRepo = yield* Effect.tryPromise({ try: () => git.checkIsRepo(), catch: gitError })
        if (!isRepo) {
          instances.delete(key)
          return yield* Effect.fail(new NotARepo())
        }
        if (!scopes.has(key)) {
          const scope = yield* Scope.make()
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              releaseFetchSemaphore(key)
            })
          )
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              releaseRepoSemaphore(key)
            })
          )
          scopes.set(key, scope)
        }
        yield* ensureCommitGraph(key)
        return git
      }),
    close: (repoPath) =>
      Effect.gen(function* () {
        const key = normalizeRepoPath(repoPath)
        instances.delete(key)
        const scope = scopes.get(key)
        if (scope) {
          scopes.delete(key)
          yield* Scope.close(scope, Exit.void)
        }
        commitGraphWritten.delete(key)
      }),
    withSessionScope: (repoPath, effect) => runOnSessionScope(normalizeRepoPath(repoPath), effect),
    requireGit: (repoPath) =>
      Effect.suspend(() => {
        const git = lookupGit(instances, repoPath)
        return git ? Effect.succeed(git) : Effect.fail(new RepoNotOpen())
      }),
    requireOpen: (repoPath) =>
      Effect.suspend(() =>
        lookupGit(instances, repoPath) ? Effect.void : Effect.fail(new RepoNotOpen())
      ),
    isCommitGraphTracked: (repoPath) => commitGraphWritten.has(normalizeRepoPath(repoPath))
  }
}

const sessions = makeRepoSessions()

// One registry value, exposed two ways: directly to the RepoNotOpen-typed helpers below, and behind
// a Layer for the operation runtime. The single-adapter Layer is deliberate consistency, not an
// abstraction to inline away — see docs/adr/0001-effect-everywhere.md.
export class RepoSessions extends Context.Tag('sidecar/RepoSessions')<
  RepoSessions,
  RepoSessionsService
>() {}

export const RepoSessionsLive = Layer.succeed(RepoSessions, sessions)

export const openSession = (repoPath: string): Effect.Effect<SimpleGit, NotARepo | GitError> =>
  sessions.open(repoPath)

export const closeSession = (repoPath: string): Effect.Effect<void> => sessions.close(repoPath)

export const requireGit = (repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen> =>
  sessions.requireGit(repoPath)

export const requireOpen = (repoPath: string): Effect.Effect<void, RepoNotOpen> =>
  sessions.requireOpen(repoPath)

export const isCommitGraphTracked = (repoPath: string): boolean =>
  sessions.isCommitGraphTracked(repoPath)

export const withSessionScope = <A, E>(
  repoPath: string,
  effect: Effect.Effect<A, E, Scope.Scope>
): Effect.Effect<A, E> => sessions.withSessionScope(repoPath, effect)
