import { Effect } from 'effect'
import { Conflict, GitError, OperationInProgress } from '../git/errors'
import { withRepoLock } from '../session/lock'
import { errorMessage, tryGit } from './helpers'
import { detectInProgressOperation } from './in-progress'

export type RawGit = { raw: (args: string[]) => Promise<string> }

export async function workingTreeHasConflicts(git: RawGit): Promise<boolean> {
  const out = await git.raw(['diff', '--name-only', '--diff-filter=U'])
  return out.trim().length > 0
}

// merge/revert/cherry-pick leave the tree conflicted on failure, but simple-git's `raw` does NOT
// reject for a conflicting merge (it resolves while the index holds unmerged entries). So the
// classification has to inspect the index for unmerged paths rather than trusting the thrown error.
export function runWithConflictDetection(
  repoPath: string,
  git: RawGit,
  args: string[],
  before?: () => Promise<void>
): Effect.Effect<void, GitError | Conflict | OperationInProgress> {
  return withRepoLock(
    repoPath,
    Effect.gen(function* () {
      // Resolving the last conflicted file empties the index of unmerged paths while the operation
      // itself is still parked, and in that window git happily starts a second one: it commits, drops
      // CHERRY_PICK_HEAD and strands the sequencer's remaining todo, silently throwing away the
      // resolution the user just made. The marker files are the only thing that still says "parked".
      const inProgress = yield* tryGit(() => detectInProgressOperation(repoPath))
      if (inProgress) {
        return yield* Effect.fail(new OperationInProgress({ operation: inProgress }))
      }
      // Refuse up front while unmerged paths exist: git would refuse anyway, but the leftover
      // conflicts would make the outcome classify as a fresh Conflict — telling the user a new
      // operation started when nothing ran at all.
      const alreadyConflicted = yield* tryGit(() => workingTreeHasConflicts(git))
      if (alreadyConflicted) {
        return yield* Effect.fail(
          new GitError({ message: `cannot ${args[0]}: resolve the current conflicts first` })
        )
      }
      if (before) {
        yield* tryGit(before)
      }
      const failure = yield* Effect.promise(() =>
        git.raw(args).then(
          () => null as string | null,
          (error) => errorMessage(error)
        )
      )
      const hasConflicts = yield* tryGit(() => workingTreeHasConflicts(git))
      if (hasConflicts) {
        return yield* Effect.fail(
          new Conflict({ message: failure ?? `${args[0]} stopped on conflicts` })
        )
      }
      if (failure !== null) {
        return yield* Effect.fail(new GitError({ message: failure }))
      }
    })
  )
}
