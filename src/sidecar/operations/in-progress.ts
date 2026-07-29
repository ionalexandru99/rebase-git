import { access } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { type GitError, OperationInProgress } from '../git/errors'
import { runGit } from '../git/spawn'
import { tryGit } from './helpers'

export type InProgressOperation = OperationInProgress['operation']

// The marker files git itself leaves behind, in the order git resolves them: a rebase replaying a
// commit also writes CHERRY_PICK_HEAD, so the broader operation has to win.
const IN_PROGRESS_MARKERS: readonly { gitPath: string; operation: InProgressOperation }[] = [
  { gitPath: 'rebase-merge', operation: 'rebase' },
  { gitPath: 'rebase-apply', operation: 'rebase' },
  { gitPath: 'MERGE_HEAD', operation: 'merge' },
  { gitPath: 'CHERRY_PICK_HEAD', operation: 'cherry-pick' },
  { gitPath: 'REVERT_HEAD', operation: 'revert' }
]

const pathExists = (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false
  )

/**
 * Which operation, if any, the repository is parked in. Asking git for the marker paths rather than
 * assuming `.git/` keeps this right for worktrees and separate git dirs.
 */
export async function detectInProgressOperation(
  key: string
): Promise<InProgressOperation | undefined> {
  const args = [
    '-C',
    key,
    'rev-parse',
    ...IN_PROGRESS_MARKERS.flatMap((marker) => ['--git-path', marker.gitPath])
  ]
  const markerPaths = (await runGit(args)).trimEnd().split('\n')
  for (const [index, marker] of IN_PROGRESS_MARKERS.entries()) {
    if (await pathExists(path.resolve(key, markerPaths[index]))) {
      return marker.operation
    }
  }
  return undefined
}

/**
 * Refuses a mutation that would rewrite the index or the working tree while an operation is parked.
 * Once the last conflict is resolved the index holds no unmerged entries, and git will happily let a
 * stash or an unstage walk off with the resolution — dropping MERGE_HEAD, or leaving the merge to be
 * committed from HEAD's side instead of the user's.
 */
export function requireNoOperation(
  repoPath: string
): Effect.Effect<void, GitError | OperationInProgress> {
  return Effect.gen(function* () {
    const inProgress = yield* tryGit(() => detectInProgressOperation(repoPath))
    if (inProgress) {
      return yield* Effect.fail(new OperationInProgress({ operation: inProgress }))
    }
  })
}

// The ref naming what the operation is applying. `am` has none, and a patch series is left
// protected wholesale rather than guessed at.
const INCOMING_REFS: Record<InProgressOperation, string | undefined> = {
  merge: 'MERGE_HEAD',
  'cherry-pick': 'CHERRY_PICK_HEAD',
  revert: 'REVERT_HEAD',
  rebase: 'REBASE_HEAD'
}

async function revision(repoPath: string, spec: string): Promise<string | undefined> {
  const output = await runGit(['-C', repoPath, 'rev-parse', '--verify', '--quiet', spec], {
    okExitCodes: [0, 1]
  })
  const resolved = output.trim()
  return resolved.length > 0 ? resolved : undefined
}

/**
 * The two ends of the change the operation is applying, or undefined when it cannot be named.
 *
 * It has to be the step's own delta, not HEAD against the incoming commit. Reverting a commit
 * reverses its diff, so a path that commit touched and nothing has touched since reads as identical
 * on both ends — the revert is staging a reversal for it while a HEAD-to-incoming comparison calls it
 * untouched. A merge has no single commit, so its delta is what the incoming side did since the base.
 */
async function stepRange(
  repoPath: string,
  operation: InProgressOperation
): Promise<{ from: string; to: string } | undefined> {
  const incoming = INCOMING_REFS[operation]
  if (!incoming) {
    return undefined
  }
  const to = await revision(repoPath, incoming)
  if (!to) {
    return undefined
  }
  if (operation === 'merge') {
    const base = await runGit(['-C', repoPath, 'merge-base', 'HEAD', to], {
      okExitCodes: [0, 1]
    }).catch(() => '')
    const from = base.trim()
    return from.length > 0 ? { from, to } : undefined
  }
  const from = await revision(repoPath, `${to}^`)
  return from ? { from, to } : undefined
}

/**
 * Of `files`, the ones the parked operation could have staged something for — a path its step does
 * not touch cannot be carrying a resolution, so whatever is staged for it is the user's own work and
 * is theirs to unstage or discard.
 *
 * Any path that was ever conflicted is necessarily in here: a conflict means the step touched it.
 * Where the step cannot be named, every path is reported as the operation's.
 */
async function operationPaths(
  repoPath: string,
  operation: InProgressOperation,
  files: readonly string[]
): Promise<string[]> {
  const range = await stepRange(repoPath, operation)
  if (!range) {
    return [...files]
  }
  const changed = await runGit([
    '-C',
    repoPath,
    'diff',
    '--name-only',
    range.from,
    range.to,
    '--',
    ...files
  ])
  return changed.split('\n').filter((line) => line.length > 0)
}

export interface PathGuardOptions {
  /** Conflicted paths a caller may still act on — discarding one is how the app resolves to our side. */
  exempt?: readonly string[]
}

/**
 * Refuses a mutation over `files` that would carry a parked operation's work back out of the index,
 * while leaving unrelated paths alone — without that escape a merge that picked up an unrelated
 * staged edit could only be undone by aborting, and abort takes the unrelated edit with it.
 */
export function requireNoOperationForPaths(
  repoPath: string,
  files: readonly string[],
  options?: PathGuardOptions
): Effect.Effect<void, GitError | OperationInProgress> {
  return Effect.gen(function* () {
    const inProgress = yield* tryGit(() => detectInProgressOperation(repoPath))
    if (!inProgress) {
      return
    }
    const exempt = new Set(options?.exempt ?? [])
    const guarded = files.filter((file) => !exempt.has(file))
    if (guarded.length === 0) {
      return
    }
    const owned = yield* tryGit(() => operationPaths(repoPath, inProgress, guarded))
    if (owned.length > 0) {
      return yield* Effect.fail(new OperationInProgress({ operation: inProgress }))
    }
  })
}
