import { Effect } from 'effect'
import { Conflict, GitError, type OperationInProgress } from '../git/errors'
import { withRepoLock } from '../session/lock'
import { errorMessage, tryGit } from './helpers'
import { requireNoOperation } from './in-progress'

export type RawGit = { raw: (args: string[]) => Promise<string> }

export async function workingTreeHasConflicts(git: RawGit): Promise<boolean> {
  const out = await git.raw(['diff', '--name-only', '--diff-filter=U'])
  return out.trim().length > 0
}

export function runWithConflictDetection(
  repoPath: string,
  git: RawGit,
  args: string[],
  before?: () => Promise<void>
): Effect.Effect<void, GitError | Conflict | OperationInProgress> {
  return withRepoLock(
    repoPath,
    Effect.gen(function* () {
      yield* requireNoOperation(repoPath)
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
