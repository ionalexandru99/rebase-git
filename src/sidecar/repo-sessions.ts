import { spawn } from 'node:child_process'
import { Context, Effect, Layer } from 'effect'
import type { SimpleGit } from 'simple-git'
import { releaseFetchSemaphore } from './fetch-semaphore'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import { type GitError, gitError, NotARepo, RepoNotOpen } from './git-errors'
import { releaseRepoSemaphore } from './repo-lock'
import { activeFetches, commitGraphWrites } from './state'

export interface RepoSessionsService {
  // Session creation only: get-or-create the instance, reject a non-repo, ensure the commit graph.
  // The UI's first reads (remotes, default branch, gitdirs) live in the openRepo operation.
  open(repoPath: string): Effect.Effect<SimpleGit, NotARepo | GitError>
  close(repoPath: string): Effect.Effect<void>
  requireGit(repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen>
  requireOpen(repoPath: string): Effect.Effect<void, RepoNotOpen>
  isCommitGraphTracked(repoPath: string): boolean
}

function makeRepoSessions(): RepoSessionsService {
  const instances = new Map<string, SimpleGit>()
  const commitGraphWritten = new Set<string>()

  // Generation numbers from a commit-graph file make `git log --topo-order` stream incrementally
  // instead of walking the full history before the first row.
  function ensureCommitGraph(key: string): void {
    if (commitGraphWritten.has(key)) {
      return
    }
    commitGraphWritten.add(key)
    const proc = spawn('git', ['-C', key, 'commit-graph', 'write', '--reachable', '--split'], {
      stdio: 'ignore',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    commitGraphWrites.set(key, proc)
    proc.on('error', () => {
      commitGraphWrites.delete(key)
    })
    proc.on('close', () => {
      commitGraphWrites.delete(key)
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
        ensureCommitGraph(key)
        return git
      }),
    close: (repoPath) =>
      Effect.sync(() => {
        const key = normalizeRepoPath(repoPath)
        instances.delete(key)
        const fetchProc = activeFetches.get(key)
        if (fetchProc && !fetchProc.killed) {
          fetchProc.kill()
        }
        activeFetches.delete(key)
        const graphProc = commitGraphWrites.get(key)
        if (graphProc && !graphProc.killed) {
          graphProc.kill()
        }
        commitGraphWrites.delete(key)
        commitGraphWritten.delete(key)
        releaseFetchSemaphore(key)
        releaseRepoSemaphore(key)
      }),
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
