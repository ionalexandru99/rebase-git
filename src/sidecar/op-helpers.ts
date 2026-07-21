import { setTimeout } from 'node:timers/promises'
import { Effect } from 'effect'
import { type GitError, gitError } from './git-errors'

export { requireGit, requireOpen } from './repo-sessions'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const INDEX_LOCK_RETRY_DELAYS_MS = [25, 50, 100]

function isIndexLockContention(error: unknown): boolean {
  const message = errorMessage(error)
  return message.includes('index.lock') && /file exists/i.test(message)
}

export async function retryIndexLock<A>(thunk: () => Promise<A>): Promise<A> {
  for (const delay of INDEX_LOCK_RETRY_DELAYS_MS) {
    try {
      return await thunk()
    } catch (error) {
      if (!isIndexLockContention(error)) {
        throw error
      }
      await setTimeout(delay)
    }
  }
  return thunk()
}

export const tryGit = <A>(thunk: () => Promise<A>): Effect.Effect<A, GitError> =>
  Effect.tryPromise({ try: () => retryIndexLock(thunk), catch: gitError })
