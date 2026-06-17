import { Schema } from 'effect'
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

const repoNotOpen = Schema.mutable(Schema.TaggedStruct('RepoNotOpen', {}))
const gitError = Schema.mutable(Schema.TaggedStruct('GitError', { message: Schema.String }))

export const StatusResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { status: GitStatusSchema })),
  repoNotOpen,
  gitError
)
export type StatusResponse = typeof StatusResponseSchema.Type

export const BranchesResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { branches: GitBranchesSchema })),
  repoNotOpen,
  gitError
)
export type BranchesResponse = typeof BranchesResponseSchema.Type

export const LocalBranchesResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { branches: LocalBranchesSchema })),
  repoNotOpen,
  gitError
)
export type LocalBranchesResponse = typeof LocalBranchesResponseSchema.Type

export const RemoteRefsResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { refs: RemoteRefsSchema })),
  repoNotOpen,
  gitError
)
export type RemoteRefsResponse = typeof RemoteRefsResponseSchema.Type

export const OpenRepoResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { result: RepoOpenSuccessSchema })),
  Schema.mutable(Schema.TaggedStruct('NotARepo', {})),
  gitError
)
export type OpenRepoResponse = typeof OpenRepoResponseSchema.Type

export const LogResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { log: GitLogSchema })),
  repoNotOpen,
  gitError
)
export type LogResponse = typeof LogResponseSchema.Type

export const StageResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', {})),
  repoNotOpen,
  gitError
)
export type StageResponse = typeof StageResponseSchema.Type

export const UnstageResponseSchema = StageResponseSchema
export type UnstageResponse = typeof UnstageResponseSchema.Type

export const GetDiffResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { diff: FileDiffSchema })),
  repoNotOpen,
  gitError
)
export type GetDiffResponse = typeof GetDiffResponseSchema.Type

export const StageHunkResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', {})),
  Schema.mutable(Schema.TaggedStruct('HunkNotFound', {})),
  repoNotOpen,
  gitError
)
export type StageHunkResponse = typeof StageHunkResponseSchema.Type

export const CommitResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { result: CommitSummarySchema })),
  repoNotOpen,
  gitError
)
export type CommitResponse = typeof CommitResponseSchema.Type

export const FetchResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', {})),
  Schema.mutable(Schema.TaggedStruct('FetchSkipped', {})),
  repoNotOpen,
  gitError
)
export type FetchResponse = typeof FetchResponseSchema.Type

export const PushResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', {})),
  repoNotOpen,
  gitError
)
export type PushResponse = typeof PushResponseSchema.Type

export const PullResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', {})),
  repoNotOpen,
  gitError
)
export type PullResponse = typeof PullResponseSchema.Type

export const StartLogStreamResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', {})),
  gitError
)
export type StartLogStreamResponse = typeof StartLogStreamResponseSchema.Type

export const CancelLogStreamResponseSchema = Schema.mutable(Schema.Struct({}))
export type CancelLogStreamResponse = typeof CancelLogStreamResponseSchema.Type

export const ScanForReposResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { repos: Schema.mutable(Schema.Array(Schema.String)) })),
  gitError
)
export type ScanForReposResponse = typeof ScanForReposResponseSchema.Type

export const CloseRepoResponseSchema = Schema.mutable(Schema.Struct({}))
export type CloseRepoResponse = typeof CloseRepoResponseSchema.Type

export const RefKindSchema = Schema.Literal('local', 'remote', 'tag')
export type RefKind = typeof RefKindSchema.Type

export const CheckoutResponseSchema = Schema.Union(
  Schema.mutable(Schema.TaggedStruct('Ok', { checkedOut: Schema.String })),
  repoNotOpen,
  gitError
)
export type CheckoutResponse = typeof CheckoutResponseSchema.Type

const okTag = Schema.mutable(Schema.TaggedStruct('Ok', {}))
const conflictTag = Schema.mutable(Schema.TaggedStruct('Conflict', { message: Schema.String }))

export const GitMutationResponseSchema = Schema.Union(okTag, repoNotOpen, gitError)
export type GitMutationResponse = typeof GitMutationResponseSchema.Type

export const ConflictableMutationResponseSchema = Schema.Union(
  okTag,
  conflictTag,
  repoNotOpen,
  gitError
)
export type ConflictableMutationResponse = typeof ConflictableMutationResponseSchema.Type

export const ResetModeSchema = Schema.Literal('soft', 'mixed', 'hard')
export type ResetMode = typeof ResetModeSchema.Type

export const StashEntrySchema = Schema.mutable(
  Schema.Struct({
    index: Schema.Number,
    ref: Schema.String,
    message: Schema.String,
    branch: Schema.String
  })
)
export type StashEntry = typeof StashEntrySchema.Type

export const StashListResponseSchema = Schema.Union(
  Schema.mutable(
    Schema.TaggedStruct('Ok', { stashes: Schema.mutable(Schema.Array(StashEntrySchema)) })
  ),
  repoNotOpen,
  gitError
)
export type StashListResponse = typeof StashListResponseSchema.Type

export const SidebarPrefsSchema = Schema.mutable(
  Schema.Struct({
    open: Schema.Boolean,
    width: Schema.Number
  })
)
export type SidebarPrefs = typeof SidebarPrefsSchema.Type

export const RefTreeTogglesSchema = Schema.mutable(Schema.Array(Schema.String))
export type RefTreeToggles = typeof RefTreeTogglesSchema.Type

export const PersistedTabsSchema = Schema.mutable(
  Schema.Struct({
    tabs: Schema.mutable(Schema.Array(Schema.NullOr(Schema.String))),
    activeIndex: Schema.Number
  })
)
export type PersistedTabs = typeof PersistedTabsSchema.Type
