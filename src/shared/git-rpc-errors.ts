import { Schema } from 'effect'

// Tagged errors that travel on the RPC error channel (separate from the success value) and serialize
// with the same `_tag`s the renderer's response unions discriminate on. Operations' sidecar-internal
// errors are adapted into these at the handler boundary.
export class RepoNotOpen extends Schema.TaggedError<RepoNotOpen>()('RepoNotOpen', {}) {}
export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  message: Schema.String
}) {}
export class HunkNotFound extends Schema.TaggedError<HunkNotFound>()('HunkNotFound', {}) {}
export class Conflict extends Schema.TaggedError<Conflict>()('Conflict', {
  message: Schema.String
}) {}
export class FetchSkipped extends Schema.TaggedError<FetchSkipped>()('FetchSkipped', {}) {}
