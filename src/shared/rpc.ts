import { Rpc, RpcGroup } from '@effect/rpc'
import { Schema } from 'effect'
import { NonNaNNumber, RequiredString } from './codec'
import { Conflict, GitError, HunkNotFound, RepoNotOpen } from './git-rpc-errors'
import {
  CommitSummarySchema,
  FileDiffSchema,
  GitBranchesSchema,
  GitLogSchema,
  GitStatusSchema,
  LocalBranchesSchema,
  RemoteRefsSchema
} from './schemas/git'
import { StashEntrySchema } from './schemas/ipc'

export { Conflict, GitError, HunkNotFound, RepoNotOpen } from './git-rpc-errors'

const ReadError = Schema.Union(RepoNotOpen, GitError)
const CommitError = Schema.Union(RepoNotOpen, GitError)
const StageError = Schema.Union(RepoNotOpen, GitError)
const HunkError = Schema.Union(RepoNotOpen, GitError, HunkNotFound)
const ConflictableError = Schema.Union(RepoNotOpen, GitError, Conflict)
const FileList = Schema.Array(RequiredString)

export const Commit = Rpc.make('commit', {
  payload: { repoPath: RequiredString, message: RequiredString },
  success: Schema.Struct({ result: CommitSummarySchema }),
  error: CommitError
})

export const StageFile = Rpc.make('stageFile', {
  payload: { repoPath: RequiredString, file: RequiredString },
  success: Schema.Void,
  error: StageError
})

export const UnstageFile = Rpc.make('unstageFile', {
  payload: { repoPath: RequiredString, file: RequiredString },
  success: Schema.Void,
  error: StageError
})

export const StageAll = Rpc.make('stageAll', {
  payload: { repoPath: RequiredString, files: FileList },
  success: Schema.Void,
  error: StageError
})

export const UnstageAll = Rpc.make('unstageAll', {
  payload: { repoPath: RequiredString, files: FileList },
  success: Schema.Void,
  error: StageError
})

export const StageHunk = Rpc.make('stageHunk', {
  payload: { repoPath: RequiredString, file: RequiredString, hunkHeader: RequiredString },
  success: Schema.Void,
  error: HunkError
})

export const UnstageHunk = Rpc.make('unstageHunk', {
  payload: { repoPath: RequiredString, file: RequiredString, hunkHeader: RequiredString },
  success: Schema.Void,
  error: HunkError
})

export const DiscardChanges = Rpc.make('discardChanges', {
  payload: { repoPath: RequiredString, files: FileList },
  success: Schema.Void,
  error: StageError
})

export const DiscardAll = Rpc.make('discardAll', {
  payload: { repoPath: RequiredString },
  success: Schema.Void,
  error: StageError
})

export const MergeBranch = Rpc.make('mergeBranch', {
  payload: { repoPath: RequiredString, ref: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const RevertCommit = Rpc.make('revertCommit', {
  payload: { repoPath: RequiredString, sha: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const CherryPick = Rpc.make('cherryPick', {
  payload: { repoPath: RequiredString, sha: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const GetStatus = Rpc.make('getStatus', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ status: GitStatusSchema }),
  error: ReadError
})

export const GetBranches = Rpc.make('getBranches', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ branches: GitBranchesSchema }),
  error: ReadError
})

export const GetLocalBranches = Rpc.make('getLocalBranches', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ branches: LocalBranchesSchema }),
  error: ReadError
})

export const GetRemoteRefs = Rpc.make('getRemoteRefs', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ refs: RemoteRefsSchema }),
  error: ReadError
})

export const GetLog = Rpc.make('getLog', {
  payload: { repoPath: RequiredString, maxCount: Schema.optional(NonNaNNumber) },
  success: Schema.Struct({ log: GitLogSchema }),
  error: ReadError
})

export const GetDiff = Rpc.make('getDiff', {
  payload: {
    repoPath: RequiredString,
    file: RequiredString,
    staged: Schema.optional(Schema.Boolean)
  },
  success: Schema.Struct({ diff: FileDiffSchema }),
  error: ReadError
})

export const StashList = Rpc.make('stashList', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ stashes: Schema.Array(StashEntrySchema) }),
  error: ReadError
})

export const SidecarRpcs = RpcGroup.make(
  Commit,
  StageFile,
  UnstageFile,
  StageAll,
  UnstageAll,
  StageHunk,
  UnstageHunk,
  DiscardChanges,
  DiscardAll,
  MergeBranch,
  RevertCommit,
  CherryPick,
  GetStatus,
  GetBranches,
  GetLocalBranches,
  GetRemoteRefs,
  GetLog,
  GetDiff,
  StashList
)

// The sidecar HTTP ops (kebab-case) that are served through the RPC group, mapped to their RPC tag.
export const rpcReadOps = {
  'get-status': 'getStatus',
  'get-branches': 'getBranches',
  'get-local-branches': 'getLocalBranches',
  'get-remote-refs': 'getRemoteRefs',
  'get-log': 'getLog',
  'get-diff': 'getDiff',
  'stash-list': 'stashList'
} as const

export type RpcReadOp = keyof typeof rpcReadOps
export type RpcReadTag = (typeof rpcReadOps)[RpcReadOp]

// Write ops migrated off the `/op/{name}` transport onto the RPC group, keyed by the op string the
// renderer sends over IPC (each op's RPC tag) and mapped to that same tag for dispatch.
export const rpcWriteOps = {
  commit: 'commit',
  stageFile: 'stageFile',
  unstageFile: 'unstageFile',
  stageAll: 'stageAll',
  unstageAll: 'unstageAll',
  stageHunk: 'stageHunk',
  unstageHunk: 'unstageHunk',
  discardChanges: 'discardChanges',
  discardAll: 'discardAll',
  mergeBranch: 'mergeBranch',
  revertCommit: 'revertCommit',
  cherryPick: 'cherryPick'
} as const

export type RpcWriteOp = keyof typeof rpcWriteOps
export type RpcWriteTag = (typeof rpcWriteOps)[RpcWriteOp]
