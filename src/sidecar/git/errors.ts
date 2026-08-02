import { GitError } from '@shared/git-rpc-errors'

export {
  AmendRejected,
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  MissingIdentity,
  NotARepo,
  OperationInProgress,
  PullDiverged,
  PushRejected,
  RepoNotOpen
} from '@shared/git-rpc-errors'

import type {
  AmendRejected,
  Conflict,
  FetchSkipped,
  HunkNotFound,
  MissingIdentity,
  NotARepo,
  OperationInProgress,
  PullDiverged,
  PushRejected,
  RepoNotOpen
} from '@shared/git-rpc-errors'

export type GitOpError =
  | GitError
  | RepoNotOpen
  | NotARepo
  | Conflict
  | HunkNotFound
  | FetchSkipped
  | PullDiverged
  | PushRejected
  | AmendRejected
  | OperationInProgress
  | MissingIdentity

export const gitError = (error: unknown): GitError =>
  new GitError({ message: error instanceof Error ? error.message : String(error) })
