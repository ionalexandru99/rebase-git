import { Schema } from 'effect'

// Tagged errors that travel on the RPC error channel (separate from the success value) and serialize
// with the same `_tag`s the renderer's response unions discriminate on. Operations' sidecar-internal
// errors are adapted into these at the handler boundary.
export class RepoNotOpen extends Schema.TaggedError<RepoNotOpen>()('RepoNotOpen', {}) {}
export class NotARepo extends Schema.TaggedError<NotARepo>()('NotARepo', {}) {}
export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  message: Schema.String
}) {}
export class HunkNotFound extends Schema.TaggedError<HunkNotFound>()('HunkNotFound', {}) {}
export class Conflict extends Schema.TaggedError<Conflict>()('Conflict', {
  message: Schema.String
}) {}
export class FetchSkipped extends Schema.TaggedError<FetchSkipped>()('FetchSkipped', {}) {}

export const LostCommit = Schema.Struct({ sha: Schema.String, subject: Schema.String })
export type LostCommit = Schema.Schema.Type<typeof LostCommit>

// A push refused for a fast-forward/lease reason (as opposed to auth/network, which stays a GitError).
// `reason` maps git's stderr to the next UI step: non-fast-forward → offer a leased force; lease-stale
// / remote-moved → the leased force was itself refused, so the sidecar has already fetched and folded
// in `lostCommits` (commits on the refreshed remote tip absent locally) and `remoteSha` (that tip) to
// pin a deliberate overwrite to exactly what the user is shown.
export class PushRejected extends Schema.TaggedError<PushRejected>()('PushRejected', {
  reason: Schema.Literal('non-fast-forward', 'lease-stale', 'remote-moved'),
  lostCommits: Schema.Array(LostCommit),
  remoteSha: Schema.optional(Schema.String)
}) {}

// An amend refused because HEAD moved underneath the compare-and-swap ref update (a background fetch,
// the .git watcher, or another action advanced it mid-amend). Like PushRejected this is an expected
// outcome, not a failure: the renderer prompts to refresh and retry instead of showing an error.
export class AmendRejected extends Schema.TaggedError<AmendRejected>()('AmendRejected', {
  reason: Schema.Literal('head-moved')
}) {}
