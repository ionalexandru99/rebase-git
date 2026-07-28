import path from 'node:path'
import type { CommitSummary } from '@shared/schemas/git'
import type { RefKind, ResetMode } from '@shared/schemas/ipc'
import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'
import { resolveDefaultBranch } from '../git/default-branch'
import { type Conflict, GitError, type NotARepo, type RepoNotOpen } from '../git/errors'
import { normalizeRepoPath } from '../git/instances'
import { isSafeRefArg } from '../git/ref-args'
import { serializeRemotes } from '../git/serialize'
import { withRepoLock } from '../session/lock'
import { closeSession, openSession, type RepoSessions } from '../session/sessions'
import { runWithConflictDetection } from './conflict'
import { requireGit, tryGit } from './helpers'

export { isCommitGraphTracked } from '../session/sessions'
export { amendCommit, casAdvanceHead, getHeadCommit } from './amend'
export {
  checkoutRef,
  createBranch,
  deleteBranch,
  getLocalBranches,
  getRemoteRefs,
  renameBranch
} from './branches'
export { getCommitDetail } from './commit-detail'
export {
  abortOperation,
  type ConflictSide,
  continueOperation,
  resolveConflict
} from './conflict-resolution'
export { detectOperationState } from './operation-state'
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

export function openRepo(
  repoPath: string
): Effect.Effect<OpenRepoResult, GitError | NotARepo, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    return yield* Effect.gen(function* () {
      const git = yield* openSession(key)
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
    }).pipe(Effect.onError(() => closeSession(key)))
  })
}

export function closeRepo(repoPath: string): Effect.Effect<void, never, RepoSessions> {
  return closeSession(repoPath)
}

interface CommitResult {
  result: CommitSummary
}

export function commit(
  repoPath: string,
  message: string
): Effect.Effect<CommitResult, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    return yield* withRepoLock(
      repoPath,
      tryGit(() => git.commit(message)).pipe(
        Effect.map((result) => ({
          result: {
            commit: result.commit,
            branch: result.branch,
            summary: {
              changes: result.summary.changes,
              insertions: result.summary.insertions,
              deletions: result.summary.deletions
            }
          }
        }))
      )
    )
  })
}

export function mergeBranch(
  repoPath: string,
  refKind: RefKind,
  fullPath: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(fullPath)) {
      return yield* Effect.fail(new GitError({ message: 'invalid ref name' }))
    }
    const mergeRef = yield* tryGit(() => mergeRefSpelling(git, refKind, fullPath))
    yield* runWithConflictDetection(repoPath, git, ['merge', '--no-edit', mergeRef, '--'])
  })
}

async function peel(git: SimpleGit, ref: string): Promise<string | undefined> {
  try {
    return (
      (await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || undefined
    )
  } catch {
    return undefined
  }
}

// git names the merge commit, MERGE_MSG and the conflict markers after the ref exactly as spelled on
// the command line, so the qualified form needed to disambiguate a branch from a same-named tag
// would otherwise leak everywhere as `Merge branch 'refs/heads/x'` and `>>>>>>> refs/heads/x`. The
// short name is what the user typed nowhere but recognises everywhere, so prefer it whenever it
// reaches the same commit; a genuine collision still falls back to the unambiguous spelling.
async function mergeRefSpelling(
  git: SimpleGit,
  refKind: RefKind,
  fullPath: string
): Promise<string> {
  const qualifiedRef = qualifyRef(refKind, fullPath)
  if (fullPath === qualifiedRef) {
    return qualifiedRef
  }
  const [shortTarget, qualifiedTarget] = await Promise.all([
    peel(git, fullPath),
    peel(git, qualifiedRef)
  ])
  return shortTarget !== undefined && shortTarget === qualifiedTarget ? fullPath : qualifiedRef
}

export function resetToCommit(
  repoPath: string,
  sha: string,
  mode: ResetMode
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
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
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
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
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
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
  message?: string,
  refKind?: RefKind
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
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
          args.push(qualifyRef(refKind, ref))
        }
        return git.raw(args)
      })
    )
  })
}

function qualifyRef(refKind: RefKind | undefined, ref: string): string {
  if (refKind === 'local') {
    return `refs/heads/${ref}`
  }
  if (refKind === 'remote') {
    return `refs/remotes/${ref}`
  }
  if (refKind === 'tag') {
    return `refs/tags/${ref}`
  }
  return ref
}

export function deleteTag(
  repoPath: string,
  name: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
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
