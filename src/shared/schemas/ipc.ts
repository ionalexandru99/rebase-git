import { Schema } from 'effect'
import { mutableArray, NonNaNNumber } from '../codec'

export { Channel } from '../channels'

const gitError = Schema.TaggedStruct('GitError', { message: Schema.String })

export const StartLogStreamResponseSchema = Schema.Union(Schema.TaggedStruct('Ok', {}), gitError)
export type StartLogStreamResponse = typeof StartLogStreamResponseSchema.Type

export const CancelLogStreamResponseSchema = Schema.Struct({})
export type CancelLogStreamResponse = typeof CancelLogStreamResponseSchema.Type

export const RefKindSchema = Schema.Literal('local', 'remote', 'tag')
export type RefKind = typeof RefKindSchema.Type

export const ResetModeSchema = Schema.Literal('soft', 'mixed', 'hard')
export type ResetMode = typeof ResetModeSchema.Type

export const StashEntrySchema = Schema.Struct({
  index: NonNaNNumber,
  ref: Schema.String,
  oid: Schema.String,
  message: Schema.String,
  branch: Schema.String
})
export type StashEntry = typeof StashEntrySchema.Type

export const SidebarPrefsSchema = Schema.Struct({
  open: Schema.Boolean,
  width: NonNaNNumber
})
export type SidebarPrefs = typeof SidebarPrefsSchema.Type

export const RefTreeTogglesSchema = mutableArray(Schema.String)
export type RefTreeToggles = typeof RefTreeTogglesSchema.Type

export const PersistedTabsSchema = Schema.Struct({
  tabs: mutableArray(Schema.NullOr(Schema.String)),
  activeIndex: NonNaNNumber
})
export type PersistedTabs = typeof PersistedTabsSchema.Type
