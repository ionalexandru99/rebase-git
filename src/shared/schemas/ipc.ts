import { Schema } from 'effect'
import { mutableArray } from '../codec'
import {
  CommitSummarySchema,
  FileDiffSchema,
  GitBranchesSchema,
  GitLogSchema,
  GitStatusSchema,
  LocalBranchesSchema,
  RemoteRefsSchema,
  RepoOpenSuccessSchema
} from './git'

export { Channel } from '../channels'

const repoNotOpen = Schema.TaggedStruct('RepoNotOpen', {})
const gitError = Schema.TaggedStruct('GitError', { message: Schema.String })

export const StatusResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { status: GitStatusSchema }),
  repoNotOpen,
  gitError
)
export type StatusResponse = typeof StatusResponseSchema.Type

export const BranchesResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { branches: GitBranchesSchema }),
  repoNotOpen,
  gitError
)
export type BranchesResponse = typeof BranchesResponseSchema.Type

export const LocalBranchesResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { branches: LocalBranchesSchema }),
  repoNotOpen,
  gitError
)
export type LocalBranchesResponse = typeof LocalBranchesResponseSchema.Type

export const RemoteRefsResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { refs: RemoteRefsSchema }),
  repoNotOpen,
  gitError
)
export type RemoteRefsResponse = typeof RemoteRefsResponseSchema.Type

export const OpenRepoResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { result: RepoOpenSuccessSchema }),
  Schema.TaggedStruct('NotARepo', {}),
  gitError
)
export type OpenRepoResponse = typeof OpenRepoResponseSchema.Type

export const LogResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { log: GitLogSchema }),
  repoNotOpen,
  gitError
)
export type LogResponse = typeof LogResponseSchema.Type

export const StageResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', {}),
  repoNotOpen,
  gitError
)
export type StageResponse = typeof StageResponseSchema.Type

export const UnstageResponseSchema = StageResponseSchema
export type UnstageResponse = typeof UnstageResponseSchema.Type

export const GetDiffResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { diff: FileDiffSchema }),
  repoNotOpen,
  gitError
)
export type GetDiffResponse = typeof GetDiffResponseSchema.Type

export const StageHunkResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', {}),
  Schema.TaggedStruct('HunkNotFound', {}),
  repoNotOpen,
  gitError
)
export type StageHunkResponse = typeof StageHunkResponseSchema.Type

export const CommitResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { result: CommitSummarySchema }),
  repoNotOpen,
  gitError
)
export type CommitResponse = typeof CommitResponseSchema.Type

export const FetchResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', {}),
  Schema.TaggedStruct('FetchSkipped', {}),
  repoNotOpen,
  gitError
)
export type FetchResponse = typeof FetchResponseSchema.Type

export const PushResponseSchema = Schema.Union(Schema.TaggedStruct('Ok', {}), repoNotOpen, gitError)
export type PushResponse = typeof PushResponseSchema.Type

export const PullResponseSchema = Schema.Union(Schema.TaggedStruct('Ok', {}), repoNotOpen, gitError)
export type PullResponse = typeof PullResponseSchema.Type

export const StartLogStreamResponseSchema = Schema.Union(Schema.TaggedStruct('Ok', {}), gitError)
export type StartLogStreamResponse = typeof StartLogStreamResponseSchema.Type

export const CancelLogStreamResponseSchema = Schema.Struct({})
export type CancelLogStreamResponse = typeof CancelLogStreamResponseSchema.Type

export const ScanForReposResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { repos: mutableArray(Schema.String) }),
  gitError
)
export type ScanForReposResponse = typeof ScanForReposResponseSchema.Type

export const RefKindSchema = Schema.Literal('local', 'remote', 'tag')
export type RefKind = typeof RefKindSchema.Type

export const CheckoutResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { checkedOut: Schema.String }),
  repoNotOpen,
  gitError
)
export type CheckoutResponse = typeof CheckoutResponseSchema.Type

// Ok / RepoNotOpen / GitError — shared by the simple write operations (branch create/delete/rename,
// reset, tag create/delete, discard, stash mutations) that have no extra success payload.
export const GitMutationResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', {}),
  repoNotOpen,
  gitError
)
export type GitMutationResponse = typeof GitMutationResponseSchema.Type

// Adds a Conflict tag for operations that can leave the working tree in a conflicted state
// (merge, revert, cherry-pick).
export const ConflictableMutationResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', {}),
  Schema.TaggedStruct('Conflict', { message: Schema.String }),
  repoNotOpen,
  gitError
)
export type ConflictableMutationResponse = typeof ConflictableMutationResponseSchema.Type

export const ResetModeSchema = Schema.Literal('soft', 'mixed', 'hard')
export type ResetMode = typeof ResetModeSchema.Type

export const StashEntrySchema = Schema.Struct({
  index: Schema.Number,
  ref: Schema.String,
  message: Schema.String,
  branch: Schema.String
})
export type StashEntry = typeof StashEntrySchema.Type

export const StashListResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { stashes: mutableArray(StashEntrySchema) }),
  repoNotOpen,
  gitError
)
export type StashListResponse = typeof StashListResponseSchema.Type

export const SidebarPrefsSchema = Schema.Struct({
  open: Schema.Boolean,
  width: Schema.Number
})
export type SidebarPrefs = typeof SidebarPrefsSchema.Type

export const RefTreeTogglesSchema = mutableArray(Schema.String)
export type RefTreeToggles = typeof RefTreeTogglesSchema.Type

export const PersistedTabsSchema = Schema.Struct({
  tabs: mutableArray(Schema.NullOr(Schema.String)),
  activeIndex: Schema.Number
})
export type PersistedTabs = typeof PersistedTabsSchema.Type
