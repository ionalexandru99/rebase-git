import { Data } from 'effect'

// Sidecar-internal git operation failures. The `_tag` of each matches the wire-level discriminant
// the renderer's response schemas already validate, so dispatch can fold the Effect error channel
// straight back onto the legacy `{ _tag, ... }` envelope (see dispatch.ts). The RPC read path maps
// the two read-relevant ones onto the @effect/rpc error classes in rpc-handlers.ts.
export class GitError extends Data.TaggedError('GitError')<{ message: string }> {}
export class RepoNotOpen extends Data.TaggedError('RepoNotOpen')<Record<never, never>> {}
export class NotARepo extends Data.TaggedError('NotARepo')<Record<never, never>> {}
export class Conflict extends Data.TaggedError('Conflict')<{ message: string }> {}
export class HunkNotFound extends Data.TaggedError('HunkNotFound')<Record<never, never>> {}
export class FetchSkipped extends Data.TaggedError('FetchSkipped')<Record<never, never>> {}

export type GitOpError = GitError | RepoNotOpen | NotARepo | Conflict | HunkNotFound | FetchSkipped

export const gitError = (error: unknown): GitError =>
  new GitError({ message: error instanceof Error ? error.message : String(error) })
