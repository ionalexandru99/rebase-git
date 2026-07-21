import { Context, Effect, ExecutionStrategy, Exit, Layer, Scope } from 'effect'
import type { SimpleGit } from 'simple-git'
import { removeAbandonedAmendIndexes } from './amend-index'
import { releaseFetchSemaphore, retainFetchSemaphore } from './fetch-semaphore'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import { type GitError, gitError, NotARepo, RepoNotOpen } from './git-errors'
import { releaseRepoSemaphore, retainRepoSemaphore } from './repo-lock'
import { startBackgroundGit } from './spawn'

export interface RepoSessionsService {
  open(repoPath: string): Effect.Effect<SimpleGit, NotARepo | GitError>
  close(repoPath: string): Effect.Effect<void>
  requireGit(repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen>
  requireOpen(repoPath: string): Effect.Effect<void, RepoNotOpen>
  isCommitGraphTracked(repoPath: string): boolean
  withSessionScope<A, E>(
    repoPath: string,
    effect: Effect.Effect<A, E, Scope.Scope>
  ): Effect.Effect<A, E>
}

function makeRepoSessions(): RepoSessionsService {
  const instances = new Map<string, SimpleGit>()
  const scopes = new Map<string, Scope.CloseableScope>()
  const commitGraphWritten = new Set<string>()

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

  function ensureCommitGraph(key: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (commitGraphWritten.has(key)) {
        return Effect.void
      }
      commitGraphWritten.add(key)
      const write = runOnSessionScope(
        key,
        Effect.gen(function* () {
          const running = yield* Effect.acquireRelease(
            Effect.sync(() =>
              startBackgroundGit(['-C', key, 'commit-graph', 'write', '--reachable', '--split'], {
                collectStdout: false,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
              })
            ),
            (process) => Effect.promise(() => process.terminate()).pipe(Effect.orDie)
          )
          yield* Effect.promise(() => running.result).pipe(
            Effect.asVoid,
            Effect.catchAll(() => Effect.void)
          )
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
          yield* Effect.promise(async () => {
            const gitDir = (await git.revparse(['--absolute-git-dir'])).trim()
            await removeAbandonedAmendIndexes(gitDir)
          }).pipe(Effect.catchAll(() => Effect.void))
          retainFetchSemaphore(key)
          retainRepoSemaphore(key)
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

export class RepoSessions extends Context.Tag('sidecar/RepoSessions')<
  RepoSessions,
  RepoSessionsService
>() {}

export const RepoSessionsLive = Layer.succeed(RepoSessions, sessions)

export const openSession = (
  repoPath: string
): Effect.Effect<SimpleGit, NotARepo | GitError, RepoSessions> =>
  RepoSessions.pipe(Effect.flatMap((service) => service.open(repoPath)))

export const closeSession = (repoPath: string): Effect.Effect<void, never, RepoSessions> =>
  RepoSessions.pipe(Effect.flatMap((service) => service.close(repoPath)))

export const requireGit = (repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen, RepoSessions> =>
  RepoSessions.pipe(Effect.flatMap((service) => service.requireGit(repoPath)))

export const requireOpen = (repoPath: string): Effect.Effect<void, RepoNotOpen, RepoSessions> =>
  RepoSessions.pipe(Effect.flatMap((service) => service.requireOpen(repoPath)))

export const isCommitGraphTracked = (repoPath: string): boolean =>
  sessions.isCommitGraphTracked(repoPath)

export const withSessionScope = <A, E>(
  repoPath: string,
  effect: Effect.Effect<A, E, Scope.Scope>
): Effect.Effect<A, E, RepoSessions> =>
  RepoSessions.pipe(Effect.flatMap((service) => service.withSessionScope(repoPath, effect)))
