import { GitError } from '@shared/git-rpc-errors'

export {
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  NotARepo,
  RepoNotOpen
} from '@shared/git-rpc-errors'

import type {
  Conflict,
  FetchSkipped,
  HunkNotFound,
  NotARepo,
  RepoNotOpen
} from '@shared/git-rpc-errors'

export type GitOpError = GitError | RepoNotOpen | NotARepo | Conflict | HunkNotFound | FetchSkipped

export const gitError = (error: unknown): GitError =>
  new GitError({ message: error instanceof Error ? error.message : String(error) })
