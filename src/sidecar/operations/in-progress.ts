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
