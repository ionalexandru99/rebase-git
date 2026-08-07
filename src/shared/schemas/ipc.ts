import { Schema } from 'effect'
import { mutableArray, NonNaNNumber, RequiredString } from '../codec'

export { Channel } from '../channels'

const gitError = Schema.TaggedStruct('GitError', { message: Schema.String })

export const StartLogStreamResponseSchema = Schema.Union(Schema.TaggedStruct('Ok', {}), gitError)
export type StartLogStreamResponse = typeof StartLogStreamResponseSchema.Type

export const CancelLogStreamResponseSchema = Schema.Struct({})
export type CancelLogStreamResponse = typeof CancelLogStreamResponseSchema.Type

export const CloneRequestSchema = Schema.Struct({
  cloneId: Schema.Int,
  url: Schema.String,
  parentDir: Schema.String,
  folderName: Schema.String
})
export type CloneRequest = typeof CloneRequestSchema.Type

export const CloneRepoResponseSchema = Schema.Union(
  Schema.TaggedStruct('Ok', { path: Schema.String }),
  gitError
)
export type CloneRepoResponse = typeof CloneRepoResponseSchema.Type

export const CloneProgressEventSchema = Schema.Struct({
  cloneId: Schema.Int,
  phase: Schema.String,
  percent: Schema.optional(NonNaNNumber)
})
export type CloneProgressEvent = typeof CloneProgressEventSchema.Type

export const RefKindSchema = Schema.Literal('local', 'remote', 'tag')
export type RefKind = typeof RefKindSchema.Type

export const ResetModeSchema = Schema.Literal('soft', 'mixed', 'hard')
export type ResetMode = typeof ResetModeSchema.Type

export const StashEntrySchema = Schema.Struct({
  index: NonNaNNumber,
  ref: Schema.String,
  oid: Schema.String,
  message: Schema.String,
  branch: Schema.String,
  lastCommitAt: Schema.optional(Schema.String)
})
export type StashEntry = typeof StashEntrySchema.Type

export const SidebarPrefsSchema = Schema.Struct({
  open: Schema.Boolean,
  width: NonNaNNumber
})
export type SidebarPrefs = typeof SidebarPrefsSchema.Type

export const ListPaneWidthQuerySchema = Schema.Struct({
  repoPath: RequiredString
})
export type ListPaneWidthQuery = typeof ListPaneWidthQuerySchema.Type

export const ListPaneWidthSchema = Schema.Struct({
  repoPath: RequiredString,
  width: NonNaNNumber
})
export type ListPaneWidth = typeof ListPaneWidthSchema.Type

export const PullDivergedStrategySchema = Schema.NullOr(Schema.Literal('rebase', 'merge'))
export type PullDivergedStrategy = typeof PullDivergedStrategySchema.Type

export const RefTreeTogglesSchema = mutableArray(Schema.String)
export type RefTreeToggles = typeof RefTreeTogglesSchema.Type

export const PersistedTabsSchema = Schema.Struct({
  tabs: mutableArray(Schema.NullOr(Schema.String)),
  activeIndex: NonNaNNumber
})
export type PersistedTabs = typeof PersistedTabsSchema.Type

export const RendererErrorReportSchema = Schema.Struct({
  message: RequiredString,
  stack: Schema.optional(Schema.String),
  componentStack: Schema.optional(Schema.String)
})
export type RendererErrorReport = typeof RendererErrorReportSchema.Type
