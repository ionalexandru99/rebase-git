import { Effect } from 'effect'
import { type GitError, gitError } from './git-errors'

export { requireGit, requireOpen } from './repo-sessions'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const tryGit = <A>(thunk: () => Promise<A>): Effect.Effect<A, GitError> =>
  Effect.tryPromise({ try: thunk, catch: gitError })
