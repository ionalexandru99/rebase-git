import { Rpc, RpcGroup } from '@effect/rpc'
import { Schema } from 'effect'
import { NonNaNNumber, RequiredString } from './codec'
import {
  AmendRejected,
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  NotARepo,
  PushRejected,
  RepoNotOpen
} from './git-rpc-errors'
import {
  CommitSummarySchema,
  FileDiffSchema,
  GitBranchesSchema,
  GitLogSchema,
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
  PushRejected,
  RepoNotOpen
} from './git-rpc-errors'

const ReadError = Schema.Union(RepoNotOpen, GitError)
const CommitError = Schema.Union(RepoNotOpen, GitError)
const StageError = Schema.Union(RepoNotOpen, GitError)
const HunkError = Schema.Union(RepoNotOpen, GitError, HunkNotFound)
const ConflictableError = Schema.Union(RepoNotOpen, GitError, Conflict)
const RefWriteError = Schema.Union(RepoNotOpen, GitError)
const FetchError = Schema.Union(RepoNotOpen, GitError, FetchSkipped)
const OpenError = Schema.Union(NotARepo, GitError)
const ScanError = Schema.Union(GitError)
const OptionalString = Schema.optional(RequiredString)
const FileList = Schema.Array(RequiredString)

export const OpenRepo = Rpc.make('openRepo', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ result: RepoOpenSuccessSchema }),
  error: OpenError
})

// closeRepo is idempotent and never fails (operations.closeRepo returns Effect<void>), so the error
// channel is Schema.Never — the handler has no failure to produce.
export const CloseRepo = Rpc.make('closeRepo', {
  payload: { repoPath: RequiredString },
  success: Schema.Void,
  error: Schema.Never
})

export const ScanForRepos = Rpc.make('scanForRepos', {
  payload: { dirPath: RequiredString },
  success: Schema.Struct({ repos: Schema.Array(RequiredString) }),
  error: ScanError
})

export const Commit = Rpc.make('commit', {
  payload: { repoPath: RequiredString, message: RequiredString },
  success: Schema.Struct({ result: CommitSummarySchema }),
  error: CommitError
})

export const GetHeadCommit = Rpc.make('getHeadCommit', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ result: HeadCommitSchema }),
  error: ReadError
})

// droppedHeadPaths is always empty in this slice (reword + fold-in only); the field is in the contract
// now so adding drop-files later doesn't churn it. AmendRejected{head-moved} is the CAS refusal.
export const AmendCommit = Rpc.make('amendCommit', {
  payload: { repoPath: RequiredString, message: RequiredString, droppedHeadPaths: FileList },
  success: Schema.Struct({ result: CommitSummarySchema }),
  error: Schema.Union(RepoNotOpen, GitError, AmendRejected)
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

export const Checkout = Rpc.make('checkout', {
  payload: { repoPath: RequiredString, refKind: RefKindSchema, fullPath: RequiredString },
  success: Schema.Struct({ checkedOut: RequiredString }),
  error: RefWriteError
})

export const CreateBranch = Rpc.make('createBranch', {
  payload: {
    repoPath: RequiredString,
    name: RequiredString,
    startPoint: OptionalString,
    checkout: Schema.optional(Schema.Boolean)
  },
  success: Schema.Void,
  error: RefWriteError
})

export const DeleteBranch = Rpc.make('deleteBranch', {
  payload: {
    repoPath: RequiredString,
    name: RequiredString,
    force: Schema.optional(Schema.Boolean)
  },
  success: Schema.Void,
  error: RefWriteError
})

export const RenameBranch = Rpc.make('renameBranch', {
  payload: { repoPath: RequiredString, oldName: RequiredString, newName: RequiredString },
  success: Schema.Void,
  error: RefWriteError
})

export const CreateTag = Rpc.make('createTag', {
  payload: {
    repoPath: RequiredString,
    name: RequiredString,
    ref: OptionalString,
    message: OptionalString
  },
  success: Schema.Void,
  error: RefWriteError
})

export const DeleteTag = Rpc.make('deleteTag', {
  payload: { repoPath: RequiredString, name: RequiredString },
  success: Schema.Void,
  error: RefWriteError
})

export const StashPop = Rpc.make('stashPop', {
  payload: { repoPath: RequiredString, index: NonNaNNumber },
  success: Schema.Void,
  error: ConflictableError
})

export const StashApply = Rpc.make('stashApply', {
  payload: { repoPath: RequiredString, index: NonNaNNumber },
  success: Schema.Void,
  error: ConflictableError
})

export const StashDrop = Rpc.make('stashDrop', {
  payload: { repoPath: RequiredString, index: NonNaNNumber },
  success: Schema.Void,
  error: RefWriteError
})

export const StashPush = Rpc.make('stashPush', {
  payload: {
    repoPath: RequiredString,
    message: OptionalString,
    includeUntracked: Schema.optional(Schema.Boolean),
    files: Schema.optional(FileList)
  },
  success: Schema.Void,
  error: RefWriteError
})

export const Reset = Rpc.make('reset', {
  payload: { repoPath: RequiredString, sha: RequiredString, mode: ResetModeSchema },
  success: Schema.Void,
  error: RefWriteError
})

export const Fetch = Rpc.make('fetch', {
  payload: { repoPath: RequiredString },
  success: Schema.Void,
  error: FetchError
})

export const Push = Rpc.make('push', {
  payload: {
    repoPath: RequiredString,
    force: Schema.optional(Schema.Literal('with-lease', 'overwrite')),
    expectedRemoteSha: OptionalString
  },
  success: Schema.Void,
  error: Schema.Union(RepoNotOpen, GitError, PushRejected)
})

export const Pull = Rpc.make('pull', {
  payload: { repoPath: RequiredString },
  success: Schema.Void,
  error: RefWriteError
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

// `range` (e.g. `HEAD~1..HEAD`) diffs a file across two commits instead of the working tree; omitting
// it preserves the original working-tree/staged behaviour exactly.
export const GetDiff = Rpc.make('getDiff', {
  payload: {
    repoPath: RequiredString,
    file: RequiredString,
    staged: Schema.optional(Schema.Boolean),
    range: Schema.optional(RequiredString)
  },
  success: Schema.Struct({ diff: FileDiffSchema }),
  error: ReadError
})

export const StashList = Rpc.make('stashList', {
  payload: { repoPath: RequiredString },
  success: Schema.Struct({ stashes: Schema.Array(StashEntrySchema) }),
  error: ReadError
})

// Streaming RPC: each emitted LogChunk is one NDJSON frame on the wire; stream completion replaces
// the old terminal "done" round-trip and stream interruption cancels the underlying `git log`. The
// payload is the single parsing point for pagination (the deleted /stream/log route validated these
// inline): skip is a non-negative int, maxCount a positive int.
export const StreamLog = Rpc.make('streamLog', {
  payload: {
    repoPath: RequiredString,
    skip: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
    maxCount: Schema.optional(Schema.Int.pipe(Schema.positive())),
    streamId: Schema.optional(Schema.Int)
  },
  success: LogChunkSchema,
  error: GitError,
  stream: true
})

export const SidecarRpcs = RpcGroup.make(
  OpenRepo,
  CloseRepo,
  ScanForRepos,
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
  GetStatus,
  GetBranches,
  GetLocalBranches,
  GetRemoteRefs,
  GetLog,
  GetDiff,
  StashList,
  StreamLog
)
