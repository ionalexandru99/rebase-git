import { Effect } from 'effect'
import { Conflict, GitError } from './git-errors'
import { errorMessage, tryGit } from './op-helpers'
import { withRepoLock } from './repo-lock'

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
  args: string[]
): Effect.Effect<void, GitError | Conflict> {
  return withRepoLock(
    repoPath,
    Effect.gen(function* () {
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
