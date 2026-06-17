import { Schema } from 'effect'
import { mutableArray } from './codec'
import {
  BranchesResponseSchema,
  CancelLogStreamResponseSchema,
  CheckoutResponseSchema,
  CommitResponseSchema,
  ConflictableMutationResponseSchema,
  FetchResponseSchema,
  GetDiffResponseSchema,
  GitMutationResponseSchema,
  LocalBranchesResponseSchema,
  LogResponseSchema,
  OpenRepoResponseSchema,
  PullResponseSchema,
  PushResponseSchema,
  RefKindSchema,
  RemoteRefsResponseSchema,
  ResetModeSchema,
  ScanForReposResponseSchema,
  StageHunkResponseSchema,
  StageResponseSchema,
  StashListResponseSchema,
  StatusResponseSchema,
  UnstageResponseSchema
} from './schemas/ipc'
import { SidecarOp, type SidecarOpName } from './sidecar-ops'

// Trims and rejects empty — mirrors the sidecar's legacy `requiredString` guard so the central
// decode is faithful to the per-op `typeof`/trim checks it replaces.
const RequiredString = Schema.Trim.pipe(Schema.minLength(1))
const OptionalString = Schema.optional(Schema.String)
const OptionalFlag = Schema.optional(Schema.Boolean)
const FileList = mutableArray(Schema.String)

const RepoOnly = Schema.Struct({ repoPath: RequiredString })

const GetDiffRequest = Schema.Struct({
  repoPath: RequiredString,
  file: RequiredString,
  staged: OptionalFlag
})

const FileRequest = Schema.Struct({ repoPath: RequiredString, file: RequiredString })
const HunkRequest = Schema.Struct({
  repoPath: RequiredString,
  file: RequiredString,
  hunkHeader: RequiredString
})
const FilesRequest = Schema.Struct({ repoPath: RequiredString, files: FileList })

const CommitRequest = Schema.Struct({ repoPath: RequiredString, message: RequiredString })
const GetLogRequest = Schema.Struct({
  repoPath: RequiredString,
  maxCount: Schema.optional(Schema.Number)
})
const CheckoutRequest = Schema.Struct({
  repoPath: RequiredString,
  fullPath: RequiredString,
  refKind: RefKindSchema
})
const CreateBranchRequest = Schema.Struct({
  repoPath: RequiredString,
  name: RequiredString,
  startPoint: OptionalString,
  checkout: OptionalFlag
})
const DeleteBranchRequest = Schema.Struct({
  repoPath: RequiredString,
  name: RequiredString,
  force: OptionalFlag
})
const RenameBranchRequest = Schema.Struct({
  repoPath: RequiredString,
  oldName: RequiredString,
  newName: RequiredString
})
const RefRequest = Schema.Struct({ repoPath: RequiredString, ref: RequiredString })
const ResetRequest = Schema.Struct({
  repoPath: RequiredString,
  sha: RequiredString,
  mode: ResetModeSchema
})
const ShaRequest = Schema.Struct({ repoPath: RequiredString, sha: RequiredString })
const CreateTagRequest = Schema.Struct({
  repoPath: RequiredString,
  name: RequiredString,
  ref: OptionalString,
  message: OptionalString
})
const NameRequest = Schema.Struct({ repoPath: RequiredString, name: RequiredString })
const StashPushRequest = Schema.Struct({
  repoPath: RequiredString,
  message: OptionalString,
  includeUntracked: OptionalFlag,
  files: Schema.optional(FileList)
})
const StashIndexRequest = Schema.Struct({ repoPath: RequiredString, index: Schema.Number })
const ScanRequest = Schema.Struct({ dirPath: RequiredString })

export const sidecarRegistry = {
  [SidecarOp.openRepo]: { request: RepoOnly, response: OpenRepoResponseSchema },
  [SidecarOp.closeRepo]: { request: RepoOnly, response: CancelLogStreamResponseSchema },
  [SidecarOp.getBranches]: { request: RepoOnly, response: BranchesResponseSchema },
  [SidecarOp.getLocalBranches]: { request: RepoOnly, response: LocalBranchesResponseSchema },
  [SidecarOp.getRemoteRefs]: { request: RepoOnly, response: RemoteRefsResponseSchema },
  [SidecarOp.getStatus]: { request: RepoOnly, response: StatusResponseSchema },
  [SidecarOp.stageFile]: { request: FileRequest, response: StageResponseSchema },
  [SidecarOp.unstageFile]: { request: FileRequest, response: UnstageResponseSchema },
  [SidecarOp.stageAll]: { request: FilesRequest, response: StageResponseSchema },
  [SidecarOp.unstageAll]: { request: FilesRequest, response: UnstageResponseSchema },
  [SidecarOp.commit]: { request: CommitRequest, response: CommitResponseSchema },
  [SidecarOp.getDiff]: { request: GetDiffRequest, response: GetDiffResponseSchema },
  [SidecarOp.stageHunk]: { request: HunkRequest, response: StageHunkResponseSchema },
  [SidecarOp.unstageHunk]: { request: HunkRequest, response: StageHunkResponseSchema },
  [SidecarOp.fetchRepo]: { request: RepoOnly, response: FetchResponseSchema },
  [SidecarOp.pushRepo]: { request: RepoOnly, response: PushResponseSchema },
  [SidecarOp.pullRepo]: { request: RepoOnly, response: PullResponseSchema },
  [SidecarOp.getLog]: { request: GetLogRequest, response: LogResponseSchema },
  [SidecarOp.checkoutRef]: { request: CheckoutRequest, response: CheckoutResponseSchema },
  [SidecarOp.createBranch]: { request: CreateBranchRequest, response: GitMutationResponseSchema },
  [SidecarOp.deleteBranch]: { request: DeleteBranchRequest, response: GitMutationResponseSchema },
  [SidecarOp.renameBranch]: { request: RenameBranchRequest, response: GitMutationResponseSchema },
  [SidecarOp.mergeBranch]: { request: RefRequest, response: ConflictableMutationResponseSchema },
  [SidecarOp.resetToCommit]: { request: ResetRequest, response: GitMutationResponseSchema },
  [SidecarOp.revertCommit]: { request: ShaRequest, response: ConflictableMutationResponseSchema },
  [SidecarOp.cherryPick]: { request: ShaRequest, response: ConflictableMutationResponseSchema },
  [SidecarOp.createTag]: { request: CreateTagRequest, response: GitMutationResponseSchema },
  [SidecarOp.deleteTag]: { request: NameRequest, response: GitMutationResponseSchema },
  [SidecarOp.stashList]: { request: RepoOnly, response: StashListResponseSchema },
  [SidecarOp.stashPush]: { request: StashPushRequest, response: GitMutationResponseSchema },
  [SidecarOp.stashApply]: {
    request: StashIndexRequest,
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.stashPop]: {
    request: StashIndexRequest,
    response: ConflictableMutationResponseSchema
  },
  [SidecarOp.stashDrop]: { request: StashIndexRequest, response: GitMutationResponseSchema },
  [SidecarOp.discardChanges]: { request: FilesRequest, response: GitMutationResponseSchema },
  [SidecarOp.discardAll]: { request: RepoOnly, response: GitMutationResponseSchema },
  [SidecarOp.scanForRepos]: { request: ScanRequest, response: ScanForReposResponseSchema }
}

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// Compile error if SidecarOp and the registry keys ever diverge — every op must have an entry.
const _everyOpRegistered: AssertEqual<keyof typeof sidecarRegistry, SidecarOpName> = true
void _everyOpRegistered

export type SidecarRequest<Op extends SidecarOpName> =
  (typeof sidecarRegistry)[Op]['request']['Type']
export type SidecarResponse<Op extends SidecarOpName> =
  (typeof sidecarRegistry)[Op]['response']['Type']
