import { access } from 'node:fs/promises'
import path from 'node:path'
import type { OperationInProgress } from '../git/errors'
import { runGit } from '../git/spawn'

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
