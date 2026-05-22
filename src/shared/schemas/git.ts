import { Schema } from 'effect'

export const RenamedFile = Schema.Struct({
  from: Schema.String,
  to: Schema.String
})
export type RenamedFile = typeof RenamedFile.Type

export const GitStatus = Schema.Struct({
  current: Schema.String,
  modified: Schema.Array(Schema.String),
  staged: Schema.Array(Schema.String),
  not_added: Schema.Array(Schema.String),
  conflicted: Schema.Array(Schema.String),
  deleted: Schema.Array(Schema.String),
  created: Schema.Array(Schema.String),
  renamed: Schema.Array(RenamedFile)
})
export type GitStatus = typeof GitStatus.Type

export const GitLogEntry = Schema.Struct({
  hash: Schema.String,
  message: Schema.String,
  author_name: Schema.String,
  date: Schema.String,
  parents: Schema.Array(Schema.String),
  refs: Schema.String
})
export type GitLogEntry = typeof GitLogEntry.Type

export const GitLog = Schema.Struct({
  all: Schema.Array(GitLogEntry),
  total: Schema.Number
})
export type GitLog = typeof GitLog.Type

export const GitBranches = Schema.Struct({
  current: Schema.String,
  all: Schema.Array(Schema.String),
  remotes: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String)
})
export type GitBranches = typeof GitBranches.Type

export const RepoOpenSuccess = Schema.Struct({
  remotes: Schema.Record({ key: Schema.String, value: Schema.String }),
  defaultBranch: Schema.optional(Schema.String),
  path: Schema.String
})
export type RepoOpenSuccess = typeof RepoOpenSuccess.Type

export const CommitSummary = Schema.Struct({
  commit: Schema.String,
  branch: Schema.String,
  summary: Schema.Struct({
    changes: Schema.Number,
    insertions: Schema.Number,
    deletions: Schema.Number
  })
})
export type CommitSummary = typeof CommitSummary.Type

export const LogChunk = Schema.Struct({
  repoPath: Schema.String,
  commits: Schema.Array(GitLogEntry),
  done: Schema.Boolean,
  error: Schema.optional(Schema.String)
})
export type LogChunk = typeof LogChunk.Type

export const RepoChangeKind = Schema.Literal('refs', 'workingTree')
export type RepoChangeKind = typeof RepoChangeKind.Type

export const RepoChangedEvent = Schema.Struct({
  repoPath: Schema.String,
  kind: RepoChangeKind
})
export type RepoChangedEvent = typeof RepoChangedEvent.Type
