import { Schema } from 'effect'
import { mutableArray, NonNaNNumber } from '../codec'

export const RenamedFileSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String
})
export type RenamedFile = typeof RenamedFileSchema.Type

export const StatusFileCodeSchema = Schema.Struct({
  path: Schema.String,
  index: Schema.String,
  working_dir: Schema.String
})
export type StatusFileCode = typeof StatusFileCodeSchema.Type

export const GitStatusSchema = Schema.Struct({
  current: Schema.String,
  modified: mutableArray(Schema.String),
  staged: mutableArray(Schema.String),
  not_added: mutableArray(Schema.String),
  conflicted: mutableArray(Schema.String),
  deleted: mutableArray(Schema.String),
  created: mutableArray(Schema.String),
  renamed: mutableArray(RenamedFileSchema),
  files: Schema.optionalWith(mutableArray(StatusFileCodeSchema), { default: () => [] })
})
export type GitStatus = typeof GitStatusSchema.Type

export const GitLogEntrySchema = Schema.Struct({
  hash: Schema.String,
  message: Schema.String,
  author_name: Schema.String,
  date: Schema.String,
  parents: mutableArray(Schema.String),
  refs: Schema.String
})
export type GitLogEntry = typeof GitLogEntrySchema.Type

export const GitLogSchema = Schema.Struct({
  all: mutableArray(GitLogEntrySchema),
  total: NonNaNNumber
})
export type GitLog = typeof GitLogSchema.Type

export const BranchTrackingSchema = Schema.Struct({
  ahead: NonNaNNumber,
  behind: NonNaNNumber
})
export type BranchTracking = typeof BranchTrackingSchema.Type

export const GitBranchesSchema = Schema.Struct({
  current: Schema.String,
  all: mutableArray(Schema.String),
  remotes: mutableArray(Schema.String),
  tags: mutableArray(Schema.String),
  tracking: Schema.optional(Schema.Record({ key: Schema.String, value: BranchTrackingSchema }))
})
export type GitBranches = typeof GitBranchesSchema.Type

export const LocalBranchesSchema = Schema.Struct({
  current: Schema.String,
  all: mutableArray(Schema.String),
  tracking: Schema.optional(Schema.Record({ key: Schema.String, value: BranchTrackingSchema }))
})
export type LocalBranches = typeof LocalBranchesSchema.Type

export const RemoteRefsSchema = Schema.Struct({
  remotes: mutableArray(Schema.String),
  tags: mutableArray(Schema.String)
})
export type RemoteRefs = typeof RemoteRefsSchema.Type

export const RepoOpenSuccessSchema = Schema.Struct({
  remotes: Schema.Record({ key: Schema.String, value: Schema.String }),
  defaultBranch: Schema.optional(Schema.String),
  path: Schema.String,
  gitDir: Schema.optional(Schema.String),
  commonDir: Schema.optional(Schema.String)
})
export type RepoOpenSuccess = typeof RepoOpenSuccessSchema.Type

export const DiffLineSchema = Schema.Struct({
  kind: Schema.Literal('context', 'add', 'del', 'meta'),
  text: Schema.String,
  oldLine: Schema.NullOr(NonNaNNumber),
  newLine: Schema.NullOr(NonNaNNumber)
})
export type DiffLine = typeof DiffLineSchema.Type

export const DiffHunkSchema = Schema.Struct({
  header: Schema.String,
  oldStart: NonNaNNumber,
  oldCount: NonNaNNumber,
  newStart: NonNaNNumber,
  newCount: NonNaNNumber,
  lines: mutableArray(DiffLineSchema)
})
export type DiffHunk = typeof DiffHunkSchema.Type

export const FileDiffSchema = Schema.Struct({
  filePath: Schema.String,
  binary: Schema.Boolean,
  hunks: mutableArray(DiffHunkSchema)
})
export type FileDiff = typeof FileDiffSchema.Type

export const CommitSummarySchema = Schema.Struct({
  commit: Schema.String,
  branch: Schema.String,
  summary: Schema.Struct({
    changes: NonNaNNumber,
    insertions: NonNaNNumber,
    deletions: NonNaNNumber
  })
})
export type CommitSummary = typeof CommitSummarySchema.Type

export const HeadCommitFileSchema = Schema.Struct({
  status: Schema.String,
  path: Schema.String
})
export type HeadCommitFile = typeof HeadCommitFileSchema.Type

// HEAD as the amend toggle needs it: the full `%B` message (subject + body), the name-status file
// list, and the parent count. Only `message` is consumed by the UI in this slice; the full shape is
// defined now so the contract doesn't churn when drop-files lands.
export const HeadCommitSchema = Schema.Struct({
  message: Schema.String,
  files: mutableArray(HeadCommitFileSchema),
  parentCount: NonNaNNumber
})
export type HeadCommit = typeof HeadCommitSchema.Type

export const LogChunkSchema = Schema.Struct({
  repoPath: Schema.String,
  commits: mutableArray(GitLogEntrySchema),
  done: Schema.Boolean,
  hasMore: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  streamId: Schema.optional(Schema.Int)
})
export type LogChunk = typeof LogChunkSchema.Type

export const RepoChangeKindSchema = Schema.Literal('refs', 'workingTree', 'index')
export type RepoChangeKind = typeof RepoChangeKindSchema.Type

export const RepoChangedEventSchema = Schema.Struct({
  repoPath: Schema.String,
  kind: RepoChangeKindSchema
})
export type RepoChangedEvent = typeof RepoChangedEventSchema.Type
