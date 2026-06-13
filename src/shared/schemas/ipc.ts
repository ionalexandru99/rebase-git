import { z } from 'zod'
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

const repoNotOpen = z.object({ _tag: z.literal('RepoNotOpen') })
const gitError = z.object({ _tag: z.literal('GitError'), message: z.string() })

export const StatusResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), status: GitStatusSchema }),
  repoNotOpen,
  gitError
])
export type StatusResponse = z.infer<typeof StatusResponseSchema>

export const BranchesResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), branches: GitBranchesSchema }),
  repoNotOpen,
  gitError
])
export type BranchesResponse = z.infer<typeof BranchesResponseSchema>

export const LocalBranchesResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), branches: LocalBranchesSchema }),
  repoNotOpen,
  gitError
])
export type LocalBranchesResponse = z.infer<typeof LocalBranchesResponseSchema>

export const RemoteRefsResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), refs: RemoteRefsSchema }),
  repoNotOpen,
  gitError
])
export type RemoteRefsResponse = z.infer<typeof RemoteRefsResponseSchema>

export const OpenRepoResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), result: RepoOpenSuccessSchema }),
  z.object({ _tag: z.literal('NotARepo') }),
  gitError
])
export type OpenRepoResponse = z.infer<typeof OpenRepoResponseSchema>

export const LogResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), log: GitLogSchema }),
  repoNotOpen,
  gitError
])
export type LogResponse = z.infer<typeof LogResponseSchema>

export const StageResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  repoNotOpen,
  gitError
])
export type StageResponse = z.infer<typeof StageResponseSchema>

export const UnstageResponseSchema = StageResponseSchema
export type UnstageResponse = z.infer<typeof UnstageResponseSchema>

export const GetDiffResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), diff: FileDiffSchema }),
  repoNotOpen,
  gitError
])
export type GetDiffResponse = z.infer<typeof GetDiffResponseSchema>

export const StageHunkResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  z.object({ _tag: z.literal('HunkNotFound') }),
  repoNotOpen,
  gitError
])
export type StageHunkResponse = z.infer<typeof StageHunkResponseSchema>

export const CommitResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), result: CommitSummarySchema }),
  repoNotOpen,
  gitError
])
export type CommitResponse = z.infer<typeof CommitResponseSchema>

export const FetchResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  z.object({ _tag: z.literal('FetchSkipped') }),
  repoNotOpen,
  gitError
])
export type FetchResponse = z.infer<typeof FetchResponseSchema>

export const PushResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  repoNotOpen,
  gitError
])
export type PushResponse = z.infer<typeof PushResponseSchema>

export const PullResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  repoNotOpen,
  gitError
])
export type PullResponse = z.infer<typeof PullResponseSchema>

export const StartLogStreamResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok') }),
  gitError
])
export type StartLogStreamResponse = z.infer<typeof StartLogStreamResponseSchema>

export const CancelLogStreamResponseSchema = z.object({})
export type CancelLogStreamResponse = z.infer<typeof CancelLogStreamResponseSchema>

export const ScanForReposResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), repos: z.array(z.string()) }),
  gitError
])
export type ScanForReposResponse = z.infer<typeof ScanForReposResponseSchema>

export const RefKindSchema = z.enum(['local', 'remote', 'tag'])
export type RefKind = z.infer<typeof RefKindSchema>

export const CheckoutResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), checkedOut: z.string() }),
  repoNotOpen,
  gitError
])
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>

const okTag = z.object({ _tag: z.literal('Ok') })
const conflictTag = z.object({ _tag: z.literal('Conflict'), message: z.string() })

// Ok / RepoNotOpen / GitError — shared by the simple write operations (branch create/delete/rename,
// reset, tag create/delete, discard, stash mutations) that have no extra success payload.
export const GitMutationResponseSchema = z.discriminatedUnion('_tag', [
  okTag,
  repoNotOpen,
  gitError
])
export type GitMutationResponse = z.infer<typeof GitMutationResponseSchema>

// Adds a Conflict tag for operations that can leave the working tree in a conflicted state
// (merge, revert, cherry-pick).
export const ConflictableMutationResponseSchema = z.discriminatedUnion('_tag', [
  okTag,
  conflictTag,
  repoNotOpen,
  gitError
])
export type ConflictableMutationResponse = z.infer<typeof ConflictableMutationResponseSchema>

export const ResetModeSchema = z.enum(['soft', 'mixed', 'hard'])
export type ResetMode = z.infer<typeof ResetModeSchema>

export const StashEntrySchema = z.object({
  index: z.number(),
  ref: z.string(),
  message: z.string(),
  branch: z.string()
})
export type StashEntry = z.infer<typeof StashEntrySchema>

export const StashListResponseSchema = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('Ok'), stashes: z.array(StashEntrySchema) }),
  repoNotOpen,
  gitError
])
export type StashListResponse = z.infer<typeof StashListResponseSchema>

export const SidebarPrefsSchema = z.object({
  open: z.boolean(),
  width: z.number()
})
export type SidebarPrefs = z.infer<typeof SidebarPrefsSchema>

export const RefTreeTogglesSchema = z.array(z.string())
export type RefTreeToggles = z.infer<typeof RefTreeTogglesSchema>

export const PersistedTabsSchema = z.object({
  tabs: z.array(z.string().nullable()),
  activeIndex: z.number()
})
export type PersistedTabs = z.infer<typeof PersistedTabsSchema>
