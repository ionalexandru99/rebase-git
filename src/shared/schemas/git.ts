import { Schema } from 'effect'
import { mutableArray, NonNaNNumber } from '../codec'

export const GIT_LOG_REF_SEPARATOR = '\x1e'

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

// `rebase-merge` and `rebase-apply` are git's two rebase backends; `am` shares the rebase-apply
// directory but is a different operation with different semantics, so it gets its own kind.
export const ConflictOperationKindSchema = Schema.Literal(
  'merge',
  'rebase-merge',
  'rebase-apply',
  'am',
  'cherry-pick',
  'revert'
)
export type ConflictOperationKind = typeof ConflictOperationKindSchema.Type

// oursLabel/theirsLabel are the real ref names behind index stages :2 and :3. During a rebase
// stage 2 is the branch rebased ONTO and stage 3 is the branch being rebased — the UI must render
// these labels, never the words "ours"/"theirs".
export const OperationStateSchema = Schema.Struct({
  kind: ConflictOperationKindSchema,
  oursLabel: Schema.String,
  theirsLabel: Schema.String,
  done: Schema.optional(NonNaNNumber),
  total: Schema.optional(NonNaNNumber),
  mergeMessage: Schema.optional(Schema.String)
})
export type OperationState = typeof OperationStateSchema.Type

export const GitStatusSchema = Schema.Struct({
  current: Schema.String,
  modified: mutableArray(Schema.String),
  staged: mutableArray(Schema.String),
  not_added: mutableArray(Schema.String),
  conflicted: mutableArray(Schema.String),
  deleted: mutableArray(Schema.String),
  created: mutableArray(Schema.String),
  renamed: mutableArray(RenamedFileSchema),
  files: Schema.optionalWith(mutableArray(StatusFileCodeSchema), { default: () => [] }),
  operation: Schema.optional(OperationStateSchema)
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
  loadedCount: NonNaNNumber
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
  path: Schema.String,
  renameSource: Schema.optional(Schema.String)
})
export type HeadCommitFile = typeof HeadCommitFileSchema.Type

export const HeadCommitSchema = Schema.Struct({
  sha: Schema.String,
  message: Schema.String,
  files: mutableArray(HeadCommitFileSchema),
  parentCount: NonNaNNumber
})
export type HeadCommit = typeof HeadCommitSchema.Type

export const CommitIdentitySchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String
})
export type CommitIdentity = typeof CommitIdentitySchema.Type

// Copies collapse into 'R' and type changes into 'M': a reader cares that a file arrived from
// somewhere else, or changed, not which of git's two flavours of it git reported.
export const CommitFileStatusSchema = Schema.Literal('A', 'M', 'D', 'R')
export type CommitFileStatus = typeof CommitFileStatusSchema.Type

export const CommitDetailFileSchema = Schema.Struct({
  path: Schema.String,
  status: CommitFileStatusSchema,
  additions: NonNaNNumber,
  deletions: NonNaNNumber,
  binary: Schema.Boolean,
  oldPath: Schema.optional(Schema.String)
})
export type CommitDetailFile = typeof CommitDetailFileSchema.Type

export const CommitDetailSchema = Schema.Struct({
  sha: Schema.String,
  author: CommitIdentitySchema,
  authorDate: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  files: mutableArray(CommitDetailFileSchema)
})
export type CommitDetail = typeof CommitDetailSchema.Type

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
