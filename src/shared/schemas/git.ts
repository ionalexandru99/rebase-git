import { z } from 'zod'

export const RenamedFileSchema = z.object({
  from: z.string(),
  to: z.string()
})
export type RenamedFile = z.infer<typeof RenamedFileSchema>

export const GitStatusSchema = z.object({
  current: z.string(),
  modified: z.array(z.string()),
  staged: z.array(z.string()),
  not_added: z.array(z.string()),
  conflicted: z.array(z.string()),
  deleted: z.array(z.string()),
  created: z.array(z.string()),
  renamed: z.array(RenamedFileSchema)
})
export type GitStatus = z.infer<typeof GitStatusSchema>

export const GitLogEntrySchema = z.object({
  hash: z.string(),
  message: z.string(),
  author_name: z.string(),
  date: z.string(),
  parents: z.array(z.string()),
  refs: z.string()
})
export type GitLogEntry = z.infer<typeof GitLogEntrySchema>

export const GitLogSchema = z.object({
  all: z.array(GitLogEntrySchema),
  total: z.number()
})
export type GitLog = z.infer<typeof GitLogSchema>

export const BranchTrackingSchema = z.object({
  ahead: z.number(),
  behind: z.number()
})
export type BranchTracking = z.infer<typeof BranchTrackingSchema>

export const GitBranchesSchema = z.object({
  current: z.string(),
  all: z.array(z.string()),
  remotes: z.array(z.string()),
  tags: z.array(z.string()),
  tracking: z.record(z.string(), BranchTrackingSchema).optional()
})
export type GitBranches = z.infer<typeof GitBranchesSchema>

export const LocalBranchesSchema = z.object({
  current: z.string(),
  all: z.array(z.string()),
  tracking: z.record(z.string(), BranchTrackingSchema).optional()
})
export type LocalBranches = z.infer<typeof LocalBranchesSchema>

export const RemoteRefsSchema = z.object({
  remotes: z.array(z.string()),
  tags: z.array(z.string())
})
export type RemoteRefs = z.infer<typeof RemoteRefsSchema>

export const RepoOpenSuccessSchema = z.object({
  remotes: z.record(z.string(), z.string()),
  defaultBranch: z.string().optional(),
  path: z.string()
})
export type RepoOpenSuccess = z.infer<typeof RepoOpenSuccessSchema>

export const CommitSummarySchema = z.object({
  commit: z.string(),
  branch: z.string(),
  summary: z.object({
    changes: z.number(),
    insertions: z.number(),
    deletions: z.number()
  })
})
export type CommitSummary = z.infer<typeof CommitSummarySchema>

export const LogChunkSchema = z.object({
  repoPath: z.string(),
  commits: z.array(GitLogEntrySchema),
  done: z.boolean(),
  hasMore: z.boolean().optional(),
  error: z.string().optional()
})
export type LogChunk = z.infer<typeof LogChunkSchema>

export const RepoChangeKindSchema = z.enum(['refs', 'workingTree'])
export type RepoChangeKind = z.infer<typeof RepoChangeKindSchema>

export const RepoChangedEventSchema = z.object({
  repoPath: z.string(),
  kind: RepoChangeKindSchema
})
export type RepoChangedEvent = z.infer<typeof RepoChangedEventSchema>
