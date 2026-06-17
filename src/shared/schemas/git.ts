import { Schema } from 'effect'

const StringArraySchema = Schema.mutable(Schema.Array(Schema.String))

export const RenamedFileSchema = Schema.mutable(
  Schema.Struct({
    from: Schema.String,
    to: Schema.String
  })
)
export type RenamedFile = typeof RenamedFileSchema.Type

export const StatusFileCodeSchema = Schema.mutable(
  Schema.Struct({
    path: Schema.String,
    index: Schema.String,
    working_dir: Schema.String
  })
)
export type StatusFileCode = typeof StatusFileCodeSchema.Type

export const GitStatusSchema = Schema.mutable(
  Schema.Struct({
    current: Schema.String,
    modified: StringArraySchema,
    staged: StringArraySchema,
    not_added: StringArraySchema,
    conflicted: StringArraySchema,
    deleted: StringArraySchema,
    created: StringArraySchema,
    renamed: Schema.mutable(Schema.Array(RenamedFileSchema)),
    files: Schema.optional(Schema.mutable(Schema.Array(StatusFileCodeSchema)))
  })
)
export type GitStatus = typeof GitStatusSchema.Type

export const GitLogEntrySchema = Schema.mutable(
  Schema.Struct({
    hash: Schema.String,
    message: Schema.String,
    author_name: Schema.String,
    date: Schema.String,
    parents: StringArraySchema,
    refs: Schema.String
  })
)
export type GitLogEntry = typeof GitLogEntrySchema.Type

export const GitLogSchema = Schema.mutable(
  Schema.Struct({
    all: Schema.mutable(Schema.Array(GitLogEntrySchema)),
    total: Schema.Number
  })
)
export type GitLog = typeof GitLogSchema.Type

export const BranchTrackingSchema = Schema.mutable(
  Schema.Struct({
    ahead: Schema.Number,
    behind: Schema.Number
  })
)
export type BranchTracking = typeof BranchTrackingSchema.Type

const BranchTrackingRecordSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: BranchTrackingSchema })
)

export const GitBranchesSchema = Schema.mutable(
  Schema.Struct({
    current: Schema.String,
    all: StringArraySchema,
    remotes: StringArraySchema,
    tags: StringArraySchema,
    tracking: Schema.optional(BranchTrackingRecordSchema)
  })
)
export type GitBranches = typeof GitBranchesSchema.Type

export const LocalBranchesSchema = Schema.mutable(
  Schema.Struct({
    current: Schema.String,
    all: StringArraySchema,
    tracking: Schema.optional(BranchTrackingRecordSchema)
  })
)
export type LocalBranches = typeof LocalBranchesSchema.Type

export const RemoteRefsSchema = Schema.mutable(
  Schema.Struct({
    remotes: StringArraySchema,
    tags: StringArraySchema
  })
)
export type RemoteRefs = typeof RemoteRefsSchema.Type

export const RepoOpenSuccessSchema = Schema.mutable(
  Schema.Struct({
    remotes: Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
    defaultBranch: Schema.optional(Schema.String),
    path: Schema.String,
    gitDir: Schema.optional(Schema.String),
    commonDir: Schema.optional(Schema.String)
  })
)
export type RepoOpenSuccess = typeof RepoOpenSuccessSchema.Type

export const DiffLineSchema = Schema.mutable(
  Schema.Struct({
    kind: Schema.Literal('context', 'add', 'del', 'meta'),
    text: Schema.String,
    oldLine: Schema.NullOr(Schema.Number),
    newLine: Schema.NullOr(Schema.Number)
  })
)
export type DiffLine = typeof DiffLineSchema.Type

export const DiffHunkSchema = Schema.mutable(
  Schema.Struct({
    header: Schema.String,
    oldStart: Schema.Number,
    oldCount: Schema.Number,
    newStart: Schema.Number,
    newCount: Schema.Number,
    lines: Schema.mutable(Schema.Array(DiffLineSchema))
  })
)
export type DiffHunk = typeof DiffHunkSchema.Type

export const FileDiffSchema = Schema.mutable(
  Schema.Struct({
    filePath: Schema.String,
    binary: Schema.Boolean,
    hunks: Schema.mutable(Schema.Array(DiffHunkSchema))
  })
)
export type FileDiff = typeof FileDiffSchema.Type

export const CommitSummarySchema = Schema.mutable(
  Schema.Struct({
    commit: Schema.String,
    branch: Schema.String,
    summary: Schema.mutable(
      Schema.Struct({
        changes: Schema.Number,
        insertions: Schema.Number,
        deletions: Schema.Number
      })
    )
  })
)
export type CommitSummary = typeof CommitSummarySchema.Type

export const LogChunkSchema = Schema.mutable(
  Schema.Struct({
    repoPath: Schema.String,
    commits: Schema.mutable(Schema.Array(GitLogEntrySchema)),
    done: Schema.Boolean,
    hasMore: Schema.optional(Schema.Boolean),
    error: Schema.optional(Schema.String),
    streamId: Schema.optional(Schema.Number.pipe(Schema.int()))
  })
)
export type LogChunk = typeof LogChunkSchema.Type

export const RepoChangeKindSchema = Schema.Literal('refs', 'workingTree', 'index')
export type RepoChangeKind = typeof RepoChangeKindSchema.Type

export const RepoChangedEventSchema = Schema.mutable(
  Schema.Struct({
    repoPath: Schema.String,
    kind: RepoChangeKindSchema
  })
)
export type RepoChangedEvent = typeof RepoChangedEventSchema.Type
