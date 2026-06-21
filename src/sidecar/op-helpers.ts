import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'
import { lookupGit } from './git/instances'
import { type GitError, gitError, RepoNotOpen } from './git-errors'
import { gitInstances } from './state'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const requireGit = (repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen> =>
  Effect.suspend(() => {
    const git = lookupGit(gitInstances, repoPath)
    return git ? Effect.succeed(git) : Effect.fail(new RepoNotOpen())
  })

export const requireOpen = (repoPath: string): Effect.Effect<void, RepoNotOpen> =>
  Effect.suspend(() =>
    lookupGit(gitInstances, repoPath) ? Effect.void : Effect.fail(new RepoNotOpen())
  )

export const tryGit = <A>(thunk: () => Promise<A>): Effect.Effect<A, GitError> =>
  Effect.tryPromise({ try: thunk, catch: gitError })
