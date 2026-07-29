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

// What the operation is bringing in, so a path can be tested against it. Every kind git gives a ref
// for is listed; `am` has none, and a patch series is left protected wholesale rather than guessed
// at.
const INCOMING_REFS: Record<InProgressOperation, string | undefined> = {
  merge: 'MERGE_HEAD',
  'cherry-pick': 'CHERRY_PICK_HEAD',
  revert: 'REVERT_HEAD',
  rebase: 'REBASE_HEAD'
}

/**
 * Of `files`, the ones the parked operation could have staged something for — a path the incoming
 * side leaves alone cannot be carrying a resolution, so whatever is staged for it is the user's own
 * work and is theirs to unstage or discard.
 *
 * Any path that was ever conflicted is necessarily in here: a conflict means both sides changed the
 * path, so it always differs between HEAD and the incoming side. Where the incoming side cannot be
 * named, every path is reported as the operation's.
 */
async function operationPaths(
  repoPath: string,
  operation: InProgressOperation,
  files: readonly string[]
): Promise<string[]> {
  const incoming = INCOMING_REFS[operation]
  if (!incoming) {
    return [...files]
  }
  const resolved = await runGit(['-C', repoPath, 'rev-parse', '--verify', '--quiet', incoming], {
    okExitCodes: [0, 1]
  })
  if (resolved.trim().length === 0) {
    return [...files]
  }
  const changed = await runGit([
    '-C',
    repoPath,
    'diff',
    '--name-only',
    'HEAD',
    resolved.trim(),
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
