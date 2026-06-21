import { spawn } from 'node:child_process'
import path from 'node:path'
import type { GitLog } from '@shared/schemas/git'
import type { ResetMode } from '@shared/schemas/ipc'
import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'
import { runWithConflictDetection } from './conflict'
import { releaseFetchSemaphore } from './fetch-semaphore'
import { resolveDefaultBranch } from './git/defaultBranch'
import { getOrCreateGit, normalizeRepoPath } from './git/instances'
import { LOG_FORMAT, parseGitLogOutput } from './git/log-format'
import { serializeRemotes } from './git/serialize'
import { type Conflict, GitError, NotARepo, type RepoNotOpen } from './git-errors'
import { requireGit, requireOpen, tryGit } from './op-helpers'
import { isSafeRefArg } from './ref-args'
import { releaseRepoSemaphore, withRepoLock } from './repo-lock'
import { runGit } from './spawn'
import { activeFetches, commitGraphWrites, gitInstances } from './state'

export {
  checkoutRef,
  createBranch,
  deleteBranch,
  getBranches,
  getLocalBranches,
  getRemoteRefs,
  renameBranch
} from './branches'
export { stashApply, stashDrop, stashList, stashPop, stashPush } from './stash'
export { fetchRepo, pullRepo, pushRepo } from './sync'
export {
  discardAll,
  discardChanges,
  getDiff,
  getStatus,
  stageAll,
  stageFile,
  stageHunk,
  unstageAll,
  unstageFile,
  unstageHunk
} from './working-tree'

const commitGraphWritten = new Set<string>()

// Generation numbers from a commit-graph file make `git log --topo-order` stream
// incrementally instead of walking the full history before the first row.
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

// Whether a commit-graph write has been started for this repo this process. closeRepo clears the
// flag so a write interrupted by close is retried on reopen rather than skipped forever.
export function isCommitGraphTracked(repoPath: string): boolean {
  return commitGraphWritten.has(normalizeRepoPath(repoPath))
}

// The real gitdir/common-dir so the main-process watcher can target HEAD/refs/index without
// running git itself: for linked worktrees and submodules `.git` is a file pointing elsewhere.
export async function resolveGitDirs(
  key: string,
  git: SimpleGit
): Promise<{ gitDir: string; commonDir: string }> {
  try {
    const output = await git.raw(['rev-parse', '--git-dir', '--git-common-dir'])
    const lines = output.split('\n').filter((line) => line.trim().length > 0)
    const gitDir = path.resolve(key, lines[0].trim())
    const commonDir = path.resolve(key, lines[1].trim())
    return { gitDir, commonDir }
  } catch {
    const gitDir = path.join(key, '.git')
    return { gitDir, commonDir: gitDir }
  }
}

interface OpenRepoResult {
  result: {
    remotes: ReturnType<typeof serializeRemotes>
    defaultBranch: string | undefined
    path: string
    gitDir: string
    commonDir: string
  }
}

export function openRepo(repoPath: string): Effect.Effect<OpenRepoResult, GitError | NotARepo> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    const git = getOrCreateGit(gitInstances, key)
    const isRepo = yield* tryGit(() => git.checkIsRepo())
    if (!isRepo) {
      gitInstances.delete(key)
      return yield* Effect.fail(new NotARepo())
    }
    ensureCommitGraph(key)
    const [remotes, defaultBranch, gitDirs] = yield* tryGit(() =>
      Promise.all([
        git.getRemotes(true),
        resolveDefaultBranch(git, undefined),
        resolveGitDirs(key, git)
      ])
    )
    return {
      result: {
        remotes: serializeRemotes(remotes),
        defaultBranch,
        path: key,
        gitDir: gitDirs.gitDir,
        commonDir: gitDirs.commonDir
      }
    }
  })
}

export function closeRepo(repoPath: string): Effect.Effect<void> {
  return Effect.sync(() => {
    const key = normalizeRepoPath(repoPath)
    gitInstances.delete(key)
    const proc = activeFetches.get(key)
    if (proc && !proc.killed) {
      proc.kill()
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
  })
}

interface CommitResult {
  result: { commit: string; branch: string; summary: Record<string, unknown> }
}

export function commit(
  repoPath: string,
  message: string
): Effect.Effect<CommitResult, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    return yield* withRepoLock(
      repoPath,
      tryGit(() => git.commit(message)).pipe(
        Effect.map((result) => ({
          result: {
            commit: result.commit,
            branch: result.branch,
            summary: { ...result.summary }
          }
        }))
      )
    )
  })
}

export function getLog(
  repoPath: string,
  maxCount?: number
): Effect.Effect<{ log: GitLog }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    const args = [
      '-C',
      repoPath,
      'log',
      '-z',
      '--branches',
      '--remotes',
      '--topo-order',
      `--format=${LOG_FORMAT}`
    ]
    if (typeof maxCount === 'number' && maxCount > 0) {
      args.splice(4, 0, `--max-count=${maxCount}`)
    }
    const raw = yield* tryGit(() => runGit(args))
    const all = parseGitLogOutput(raw)
    return { log: { all, total: all.length } }
  })
}

export function mergeBranch(
  repoPath: string,
  ref: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(ref)) {
      return yield* Effect.fail(new GitError({ message: 'invalid ref name' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['merge', '--no-edit', ref, '--'])
  })
}

export function resetToCommit(
  repoPath: string,
  sha: string,
  mode: ResetMode
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: 'invalid commit' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['reset', `--${mode}`, sha, '--']))
    )
  })
}

export function revertCommit(
  repoPath: string,
  sha: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: 'invalid commit' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['revert', '--no-edit', sha])
  })
}

export function cherryPick(
  repoPath: string,
  sha: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: 'invalid commit' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['cherry-pick', sha])
  })
}

export function createTag(
  repoPath: string,
  name: string,
  ref?: string,
  message?: string
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(name) || (ref !== undefined && !isSafeRefArg(ref))) {
      return yield* Effect.fail(new GitError({ message: 'invalid tag name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => {
        const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name]
        if (ref) {
          args.push(ref)
        }
        return git.raw(args)
      })
    )
  })
}

export function deleteTag(
  repoPath: string,
  name: string
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(name)) {
      return yield* Effect.fail(new GitError({ message: 'invalid tag name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['tag', '-d', name]))
    )
  })
}
