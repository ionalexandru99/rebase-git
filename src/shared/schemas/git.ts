import { Schema } from 'effect'

export const RenamedFile = Schema.mutable(
  Schema.Struct({
    from: Schema.String,
    to: Schema.String
  })
)
export type RenamedFile = typeof RenamedFile.Type

export const GitStatus = Schema.mutable(
  Schema.Struct({
    current: Schema.String,
    modified: Schema.mutable(Schema.Array(Schema.String)),
    staged: Schema.mutable(Schema.Array(Schema.String)),
    not_added: Schema.mutable(Schema.Array(Schema.String)),
    conflicted: Schema.mutable(Schema.Array(Schema.String)),
    deleted: Schema.mutable(Schema.Array(Schema.String)),
    created: Schema.mutable(Schema.Array(Schema.String)),
    renamed: Schema.mutable(Schema.Array(RenamedFile))
  })
)
export type GitStatus = typeof GitStatus.Type

export const GitLogEntry = Schema.mutable(
  Schema.Struct({
    hash: Schema.String,
    message: Schema.String,
    author_name: Schema.String,
    date: Schema.String,
    parents: Schema.mutable(Schema.Array(Schema.String)),
    refs: Schema.String
  })
)
export type GitLogEntry = typeof GitLogEntry.Type

export const GitLog = Schema.mutable(
  Schema.Struct({
    all: Schema.mutable(Schema.Array(GitLogEntry)),
    total: Schema.Number
  })
)
export type GitLog = typeof GitLog.Type

export const BranchTracking = Schema.Struct({
  ahead: Schema.Number,
  behind: Schema.Number
})
export type BranchTracking = typeof BranchTracking.Type

export const GitBranches = Schema.mutable(
  Schema.Struct({
    current: Schema.String,
    all: Schema.mutable(Schema.Array(Schema.String)),
    remotes: Schema.mutable(Schema.Array(Schema.String)),
    tags: Schema.mutable(Schema.Array(Schema.String)),
    tracking: Schema.optional(
      Schema.mutable(Schema.Record({ key: Schema.String, value: BranchTracking }))
    )
  })
)
export type GitBranches = typeof GitBranches.Type

export const RepoOpenSuccess = Schema.mutable(
  Schema.Struct({
    remotes: Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
    defaultBranch: Schema.optional(Schema.String),
    path: Schema.String
  })
)
export type RepoOpenSuccess = typeof RepoOpenSuccess.Type

export const CommitSummary = Schema.mutable(
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
export type CommitSummary = typeof CommitSummary.Type

export const LogChunk = Schema.mutable(
  Schema.Struct({
    repoPath: Schema.String,
    commits: Schema.mutable(Schema.Array(GitLogEntry)),
    done: Schema.Boolean,
    error: Schema.optional(Schema.String)
  })
)
export type LogChunk = typeof LogChunk.Type

export const RepoChangeKind = Schema.Literal('refs', 'workingTree')
export type RepoChangeKind = typeof RepoChangeKind.Type

export const RepoChangedEvent = Schema.mutable(
  Schema.Struct({
    repoPath: Schema.String,
    kind: RepoChangeKind
  })
)
export type RepoChangedEvent = typeof RepoChangedEvent.Type
