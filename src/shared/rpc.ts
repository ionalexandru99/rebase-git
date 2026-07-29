import { Rpc, RpcGroup } from '@effect/rpc'
import { Schema } from 'effect'
import { NonNaNNumber, OpaqueHunkHeaderString, OpaqueString, RequiredString } from './codec'
import {
  AmendRejected,
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  NotARepo,
  OperationInProgress,
  PushRejected,
  RepoNotOpen
} from './git-rpc-errors'
import type { RpcResult } from './rpc-result'
import {
  CloneProgressSchema,
  CommitDetailSchema,
  CommitSummarySchema,
  FileDiffSchema,
  GitStatusSchema,
  HeadCommitSchema,
  LocalBranchesSchema,
  LogChunkSchema,
  RemoteRefsSchema,
  RepoOpenSuccessSchema
} from './schemas/git'
import { RefKindSchema, ResetModeSchema, StashEntrySchema } from './schemas/ipc'

export {
  AmendRejected,
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  NotARepo,
  OperationInProgress,
  PushRejected,
  RepoNotOpen
} from './git-rpc-errors'

const ReadError = Schema.Union(RepoNotOpen, GitError)
const CommitError = Schema.Union(RepoNotOpen, GitError)
const StageError = Schema.Union(RepoNotOpen, GitError)
// Unstaging or stashing while an operation is parked carries the resolution out of the index and
// abandons the operation with it, so these refuse where their staging counterparts do not.
const GuardedWriteError = Schema.Union(RepoNotOpen, GitError, OperationInProgress)
const HunkError = Schema.Union(RepoNotOpen, GitError, HunkNotFound)
const GuardedHunkError = Schema.Union(RepoNotOpen, GitError, HunkNotFound, OperationInProgress)
const ConflictableError = Schema.Union(RepoNotOpen, GitError, Conflict, OperationInProgress)
const RefWriteError = Schema.Union(RepoNotOpen, GitError)
const FetchError = Schema.Union(RepoNotOpen, GitError, FetchSkipped)
const OpenError = Schema.Union(NotARepo, GitError)
const ScanError = Schema.Union(GitError)
const OptionalString = Schema.optional(RequiredString)
const FileList = Schema.Array(OpaqueString)

export const OpenRepo = Rpc.make('openRepo', {
  payload: { repoPath: OpaqueString },
  success: Schema.Struct({ result: RepoOpenSuccessSchema }),
  error: OpenError
})

export const CloseRepo = Rpc.make('closeRepo', {
  payload: { repoPath: OpaqueString },
  success: Schema.Void,
  error: Schema.Never
})

export const ScanForRepos = Rpc.make('scanForRepos', {
  payload: { dirPath: OpaqueString },
  success: Schema.Struct({ repos: Schema.Array(OpaqueString) }),
  error: ScanError
})

// Streamed rather than a plain call: a clone can run for minutes, so it needs progress on the way
// and must not sit under the request timeout every other op shares.
export const CloneRepo = Rpc.make('cloneRepo', {
  payload: {
    url: RequiredString,
    parentDir: OpaqueString,
    folderName: RequiredString
  },
  success: CloneProgressSchema,
  error: ScanError,
  stream: true
})

export const Commit = Rpc.make('commit', {
  payload: { repoPath: OpaqueString, message: RequiredString },
  success: Schema.Struct({ result: CommitSummarySchema }),
  error: CommitError
})

export const GetHeadCommit = Rpc.make('getHeadCommit', {
  payload: { repoPath: OpaqueString },
  success: Schema.Struct({ result: HeadCommitSchema }),
  error: ReadError
})

const DroppedHunks = Schema.Array(
  Schema.Struct({ file: OpaqueString, hunks: Schema.Array(OpaqueHunkHeaderString) })
)

export const AmendCommit = Rpc.make('amendCommit', {
  payload: {
    repoPath: OpaqueString,
    message: RequiredString,
    expectedHead: RequiredString,
    droppedHeadPaths: FileList,
    droppedHeadHunks: DroppedHunks
  },
  success: Schema.Struct({ result: CommitSummarySchema }),
  error: Schema.Union(RepoNotOpen, GitError, AmendRejected, OperationInProgress, HunkNotFound)
})

export const StageFile = Rpc.make('stageFile', {
  payload: { repoPath: OpaqueString, file: OpaqueString },
  success: Schema.Void,
  error: StageError
})

export const UnstageFile = Rpc.make('unstageFile', {
  payload: {
    repoPath: OpaqueString,
    file: OpaqueString,
    renameSource: Schema.optional(OpaqueString)
  },
  success: Schema.Void,
  error: GuardedWriteError
})

export const StageAll = Rpc.make('stageAll', {
  payload: { repoPath: OpaqueString, files: FileList },
  success: Schema.Void,
  error: StageError
})

export const UnstageAll = Rpc.make('unstageAll', {
  payload: { repoPath: OpaqueString, files: FileList },
  success: Schema.Void,
  error: GuardedWriteError
})

export const StageHunk = Rpc.make('stageHunk', {
  payload: { repoPath: OpaqueString, file: OpaqueString, hunkHeader: OpaqueHunkHeaderString },
  success: Schema.Void,
  error: HunkError
})

export const UnstageHunk = Rpc.make('unstageHunk', {
  payload: { repoPath: OpaqueString, file: OpaqueString, hunkHeader: OpaqueHunkHeaderString },
  success: Schema.Void,
  error: GuardedHunkError
})

export const DiscardChanges = Rpc.make('discardChanges', {
  payload: { repoPath: OpaqueString, files: FileList },
  success: Schema.Void,
  error: GuardedWriteError
})

export const DiscardAll = Rpc.make('discardAll', {
  payload: { repoPath: OpaqueString },
  success: Schema.Void,
  error: StageError
})

export const MergeBranch = Rpc.make('mergeBranch', {
  payload: { repoPath: OpaqueString, refKind: RefKindSchema, fullPath: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const RevertCommit = Rpc.make('revertCommit', {
  payload: { repoPath: OpaqueString, sha: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const CherryPick = Rpc.make('cherryPick', {
  payload: { repoPath: OpaqueString, sha: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const Checkout = Rpc.make('checkout', {
  payload: { repoPath: OpaqueString, refKind: RefKindSchema, fullPath: RequiredString },
  success: Schema.Struct({ checkedOut: RequiredString }),
  error: GuardedWriteError
})

export const CreateBranch = Rpc.make('createBranch', {
  payload: {
    repoPath: OpaqueString,
    name: RequiredString,
    startPoint: OptionalString,
    startPointKind: Schema.optional(RefKindSchema),
    checkout: Schema.optional(Schema.Boolean)
  },
  success: Schema.Void,
  error: GuardedWriteError
})

export const DeleteBranch = Rpc.make('deleteBranch', {
  payload: {
    repoPath: OpaqueString,
    name: RequiredString,
    force: Schema.optional(Schema.Boolean)
  },
  success: Schema.Void,
  error: RefWriteError
})

export const RenameBranch = Rpc.make('renameBranch', {
  payload: { repoPath: OpaqueString, oldName: RequiredString, newName: RequiredString },
  success: Schema.Void,
  error: RefWriteError
})

export const CreateTag = Rpc.make('createTag', {
  payload: {
    repoPath: OpaqueString,
    name: RequiredString,
    ref: OptionalString,
    refKind: Schema.optional(RefKindSchema),
    message: OptionalString
  },
  success: Schema.Void,
  error: RefWriteError
})

export const DeleteTag = Rpc.make('deleteTag', {
  payload: { repoPath: OpaqueString, name: RequiredString },
  success: Schema.Void,
  error: RefWriteError
})

export const StashPop = Rpc.make('stashPop', {
  payload: { repoPath: OpaqueString, index: NonNaNNumber, expectedOid: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const StashApply = Rpc.make('stashApply', {
  payload: { repoPath: OpaqueString, index: NonNaNNumber, expectedOid: RequiredString },
  success: Schema.Void,
  error: ConflictableError
})

export const StashDrop = Rpc.make('stashDrop', {
  payload: { repoPath: OpaqueString, index: NonNaNNumber, expectedOid: RequiredString },
  success: Schema.Void,
  error: RefWriteError
})

export const StashPush = Rpc.make('stashPush', {
  payload: {
    repoPath: OpaqueString,
    message: OptionalString,
    includeUntracked: Schema.optional(Schema.Boolean),
    files: Schema.optional(FileList)
  },
  success: Schema.Void,
  error: GuardedWriteError
})

export const Reset = Rpc.make('reset', {
  payload: { repoPath: OpaqueString, sha: RequiredString, mode: ResetModeSchema },
  success: Schema.Void,
  error: GuardedWriteError
})

export const Fetch = Rpc.make('fetch', {
  payload: { repoPath: OpaqueString },
  success: Schema.Void,
  error: FetchError
})

export const Push = Rpc.make('push', {
  payload: {
    repoPath: OpaqueString,
    force: Schema.optional(Schema.Literal('with-lease', 'overwrite')),
    expectedRemoteSha: OptionalString
  },
  success: Schema.Void,
  error: Schema.Union(RepoNotOpen, GitError, PushRejected)
})

export const Pull = Rpc.make('pull', {
  payload: { repoPath: OpaqueString },
  success: Schema.Void,
  error: RefWriteError
})

export const AbortOperation = Rpc.make('abortOperation', {
  payload: { repoPath: OpaqueString },
  success: Schema.Void,
  error: RefWriteError
})

// Continuing a multi-commit cherry-pick/revert/rebase can immediately conflict again on the next
// commit, so this is conflictable like the operations that start a sequence.
export const ContinueOperation = Rpc.make('continueOperation', {
  payload: { repoPath: OpaqueString },
  success: Schema.Void,
  error: ConflictableError
})

export const ResolveConflict = Rpc.make('resolveConflict', {
  payload: {
    repoPath: OpaqueString,
    file: OpaqueString,
    side: Schema.Literal('ours', 'theirs')
  },
  success: Schema.Void,
  error: StageError
})

export const GetStatus = Rpc.make('getStatus', {
  payload: { repoPath: OpaqueString },
  success: Schema.Struct({ status: GitStatusSchema }),
  error: ReadError
})

export const GetLocalBranches = Rpc.make('getLocalBranches', {
  payload: { repoPath: OpaqueString },
  success: Schema.Struct({ branches: LocalBranchesSchema }),
  error: ReadError
})

export const GetRemoteRefs = Rpc.make('getRemoteRefs', {
  payload: { repoPath: OpaqueString },
  success: Schema.Struct({ refs: RemoteRefsSchema }),
  error: ReadError
})

export const GetDiff = Rpc.make('getDiff', {
  payload: {
    repoPath: OpaqueString,
    file: OpaqueString,
    staged: Schema.optional(Schema.Boolean),
    range: Schema.optional(RequiredString),
    commit: Schema.optional(RequiredString),
    renameSource: Schema.optional(OpaqueString)
  },
  success: Schema.Struct({ diff: FileDiffSchema }),
  error: ReadError
})

export const GetCommitDetail = Rpc.make('getCommitDetail', {
  payload: { repoPath: OpaqueString, sha: RequiredString },
  success: Schema.Struct({ detail: CommitDetailSchema }),
  error: ReadError
})

export const StashList = Rpc.make('stashList', {
  payload: { repoPath: OpaqueString },
  success: Schema.Struct({ stashes: Schema.Array(StashEntrySchema) }),
  error: ReadError
})

export const StreamLog = Rpc.make('streamLog', {
  payload: {
    repoPath: OpaqueString,
    skip: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
    maxCount: Schema.optional(Schema.Int.pipe(Schema.positive())),
    streamId: Schema.optional(Schema.Int)
  },
  success: LogChunkSchema,
  error: Schema.Union(RepoNotOpen, GitError),
  stream: true
})

export const SidecarRpcs = RpcGroup.make(
  OpenRepo,
  CloseRepo,
  ScanForRepos,
  CloneRepo,
  Commit,
  GetHeadCommit,
  AmendCommit,
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
  Checkout,
  CreateBranch,
  DeleteBranch,
  RenameBranch,
  CreateTag,
  DeleteTag,
  StashPop,
  StashApply,
  StashDrop,
  StashPush,
  Reset,
  Fetch,
  Push,
  Pull,
  AbortOperation,
  ContinueOperation,
  ResolveConflict,
  GetStatus,
  GetLocalBranches,
  GetRemoteRefs,
  GetDiff,
  GetCommitDetail,
  StashList,
  StreamLog
)

export type SidecarRpc = RpcGroup.Rpcs<typeof SidecarRpcs>
export type SidecarRpcTag = SidecarRpc['_tag']
export type SidecarRpcError = Rpc.ErrorExit<SidecarRpc>
export type SidecarRpcErrorResponse = Rpc.ErrorExitEncoded<SidecarRpc>
export type SidecarRpcResponse = RpcResult<
  Rpc.SuccessExitEncoded<SidecarRpc>,
  SidecarRpcErrorResponse
>
