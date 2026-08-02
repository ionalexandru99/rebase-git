import { Schema } from 'effect'

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
export class MissingIdentity extends Schema.TaggedError<MissingIdentity>()('MissingIdentity', {}) {}

export const LostCommit = Schema.Struct({ sha: Schema.String, subject: Schema.String })
export type LostCommit = Schema.Schema.Type<typeof LostCommit>

export class PushRejected extends Schema.TaggedError<PushRejected>()('PushRejected', {
  reason: Schema.Literal('non-fast-forward', 'lease-stale', 'remote-moved'),
  lostCommits: Schema.Array(LostCommit),
  remoteSha: Schema.optional(Schema.String)
}) {}

export class PullDiverged extends Schema.TaggedError<PullDiverged>()('PullDiverged', {}) {}

export class AmendRejected extends Schema.TaggedError<AmendRejected>()('AmendRejected', {
  reason: Schema.Literal('head-moved')
}) {}

export class OperationInProgress extends Schema.TaggedError<OperationInProgress>()(
  'OperationInProgress',
  {
    operation: Schema.Literal('merge', 'cherry-pick', 'revert', 'rebase')
  }
) {}
