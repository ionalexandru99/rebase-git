import { parseOrThrow } from '@shared/codec'
import {
  AbortOperation,
  AmendCommit,
  Checkout,
  CherryPick,
  Commit,
  ContinueOperation,
  CreateBranch,
  CreateTag,
  DeleteBranch,
  DeleteTag,
  DiscardAll,
  DiscardChanges,
  DiscardHunk,
  Fetch,
  GetCommitDetail,
  GetDiff,
  GetHeadCommit,
  GetLocalBranches,
  GetRemoteRefs,
  GetStatus,
  MergeBranch,
  OpenRepo,
  Pull,
  Push,
  RenameBranch,
  Reset,
  ResolveConflict,
  RevertCommit,
  ScanForRepos,
  StageAll,
  StageFile,
  StageHunk,
  StashApply,
  StashDrop,
  StashList,
  StashPop,
  StashPush,
  UnstageAll,
  UnstageFile,
  UnstageHunk
} from '@shared/rpc'
import { type RpcContract, type RpcResult, rpcResultSchema } from '@shared/rpc-result'
import type { RefKind, ResetMode } from '@shared/schemas/ipc'

async function callSidecarRpc<Success, SuccessInput, Failure, FailureInput>(
  rpc: RpcContract<Success, SuccessInput, Failure, FailureInput>,
  body: Record<string, unknown>
): Promise<RpcResult<Success, Failure>> {
  const payload = await window.electronAPI.sidecarRequest(rpc._tag, body)
  return parseOrThrow(rpcResultSchema(rpc), payload)
}

export type CommitPayload = typeof Commit.payloadSchema.Type
export type CommitResult = RpcResult<
  typeof Commit.successSchema.Type,
  typeof Commit.errorSchema.Type
>
export type HeadCommitResult = RpcResult<
  typeof GetHeadCommit.successSchema.Type,
  typeof GetHeadCommit.errorSchema.Type
>
export type AmendResult = RpcResult<
  typeof AmendCommit.successSchema.Type,
  typeof AmendCommit.errorSchema.Type
>
export type OpenRepoResult = RpcResult<
  typeof OpenRepo.successSchema.Type,
  typeof OpenRepo.errorSchema.Type
>
export type ScanForReposResult = RpcResult<
  typeof ScanForRepos.successSchema.Type,
  typeof ScanForRepos.errorSchema.Type
>
export type StageResult = RpcResult<
  typeof StageFile.successSchema.Type,
  typeof StageFile.errorSchema.Type
>
export type HunkResult = RpcResult<
  typeof StageHunk.successSchema.Type,
  typeof StageHunk.errorSchema.Type
>
export type GuardedWriteResult = RpcResult<
  typeof UnstageFile.successSchema.Type,
  typeof UnstageFile.errorSchema.Type
>
export type GuardedHunkResult = RpcResult<
  typeof UnstageHunk.successSchema.Type,
  typeof UnstageHunk.errorSchema.Type
>
export type ConflictableResult = RpcResult<
  typeof MergeBranch.successSchema.Type,
  typeof MergeBranch.errorSchema.Type
>
export type RefWriteResult = RpcResult<
  typeof DeleteBranch.successSchema.Type,
  typeof DeleteBranch.errorSchema.Type
>
export type PushResult = RpcResult<typeof Push.successSchema.Type, typeof Push.errorSchema.Type>
export type PushForce = NonNullable<typeof Push.payloadSchema.Type.force>
export type ConflictSide = typeof ResolveConflict.payloadSchema.Type.side
export type CheckoutResult = RpcResult<
  typeof Checkout.successSchema.Type,
  typeof Checkout.errorSchema.Type
>
export type FetchResult = RpcResult<typeof Fetch.successSchema.Type, typeof Fetch.errorSchema.Type>
export type StatusResult = RpcResult<
  typeof GetStatus.successSchema.Type,
  typeof GetStatus.errorSchema.Type
>
export type LocalBranchesResult = RpcResult<
  typeof GetLocalBranches.successSchema.Type,
  typeof GetLocalBranches.errorSchema.Type
>
export type RemoteRefsResult = RpcResult<
  typeof GetRemoteRefs.successSchema.Type,
  typeof GetRemoteRefs.errorSchema.Type
>
export type DiffResult = RpcResult<
  typeof GetDiff.successSchema.Type,
  typeof GetDiff.errorSchema.Type
>
export type CommitDetailResult = RpcResult<
  typeof GetCommitDetail.successSchema.Type,
  typeof GetCommitDetail.errorSchema.Type
>
export type StashListResult = RpcResult<
  typeof StashList.successSchema.Type,
  typeof StashList.errorSchema.Type
>

export async function rpcOpenRepo(repoPath: string, owner: number): Promise<OpenRepoResult> {
  return parseOrThrow(rpcResultSchema(OpenRepo), await window.electronAPI.openRepo(repoPath, owner))
}

export async function rpcCloseRepo(repoPath: string, owner: number): Promise<void> {
  await window.electronAPI.closeRepo(repoPath, owner)
}

export async function rpcDisownRepo(repoPath: string, owner: number): Promise<void> {
  await window.electronAPI.disownRepo(repoPath, owner)
}

export async function rpcScanForRepos(dirPath: string): Promise<ScanForReposResult> {
  return parseOrThrow(rpcResultSchema(ScanForRepos), await window.electronAPI.scanForRepos(dirPath))
}

export async function rpcCommit(repoPath: string, message: string): Promise<CommitResult> {
  return callSidecarRpc(Commit, { repoPath, message })
}

export async function rpcGetHeadCommit(repoPath: string): Promise<HeadCommitResult> {
  return callSidecarRpc(GetHeadCommit, { repoPath })
}

export async function rpcAmendCommit(
  repoPath: string,
  message: string,
  droppedHeadPaths: string[],
  droppedHeadHunks: { file: string; hunks: string[] }[],
  expectedHead: string
): Promise<AmendResult> {
  return callSidecarRpc(AmendCommit, {
    repoPath,
    message,
    expectedHead,
    droppedHeadPaths,
    droppedHeadHunks
  })
}

export async function rpcStageFile(repoPath: string, file: string): Promise<StageResult> {
  return callSidecarRpc(StageFile, { repoPath, file })
}

export async function rpcUnstageFile(
  repoPath: string,
  file: string,
  renameSource?: string
): Promise<GuardedWriteResult> {
  return callSidecarRpc(UnstageFile, { repoPath, file, renameSource })
}

export async function rpcStageAll(repoPath: string, files: string[]): Promise<StageResult> {
  return callSidecarRpc(StageAll, { repoPath, files })
}

export async function rpcUnstageAll(
  repoPath: string,
  files: string[]
): Promise<GuardedWriteResult> {
  return callSidecarRpc(UnstageAll, { repoPath, files })
}

export async function rpcStageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<HunkResult> {
  return callSidecarRpc(StageHunk, {
    repoPath,
    file,
    hunkHeader
  })
}

export async function rpcUnstageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<GuardedHunkResult> {
  return callSidecarRpc(UnstageHunk, {
    repoPath,
    file,
    hunkHeader
  })
}

export async function rpcDiscardHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<HunkResult> {
  return callSidecarRpc(DiscardHunk, {
    repoPath,
    file,
    hunkHeader
  })
}

export async function rpcDiscardChanges(
  repoPath: string,
  files: string[]
): Promise<GuardedWriteResult> {
  return callSidecarRpc(DiscardChanges, { repoPath, files })
}

export async function rpcDiscardAll(repoPath: string): Promise<StageResult> {
  return callSidecarRpc(DiscardAll, { repoPath })
}

export async function rpcMergeBranch(
  repoPath: string,
  refKind: RefKind,
  fullPath: string
): Promise<ConflictableResult> {
  return callSidecarRpc(MergeBranch, { repoPath, refKind, fullPath })
}

export async function rpcRevertCommit(repoPath: string, sha: string): Promise<ConflictableResult> {
  return callSidecarRpc(RevertCommit, { repoPath, sha })
}

export async function rpcCherryPick(repoPath: string, sha: string): Promise<ConflictableResult> {
  return callSidecarRpc(CherryPick, { repoPath, sha })
}

export async function rpcCheckout(
  repoPath: string,
  refKind: RefKind,
  fullPath: string
): Promise<CheckoutResult> {
  return callSidecarRpc(Checkout, {
    repoPath,
    refKind,
    fullPath
  })
}

export async function rpcCreateBranch(
  repoPath: string,
  name: string,
  startPoint?: string,
  checkout?: boolean,
  startPointKind?: RefKind
): Promise<GuardedWriteResult> {
  return callSidecarRpc(CreateBranch, {
    repoPath,
    name,
    startPoint,
    startPointKind,
    checkout
  })
}

export async function rpcDeleteBranch(
  repoPath: string,
  name: string,
  force?: boolean
): Promise<RefWriteResult> {
  return callSidecarRpc(DeleteBranch, {
    repoPath,
    name,
    force
  })
}

export async function rpcRenameBranch(
  repoPath: string,
  oldName: string,
  newName: string
): Promise<RefWriteResult> {
  return callSidecarRpc(RenameBranch, {
    repoPath,
    oldName,
    newName
  })
}

export async function rpcCreateTag(
  repoPath: string,
  name: string,
  ref?: string,
  message?: string,
  refKind?: RefKind
): Promise<RefWriteResult> {
  return callSidecarRpc(CreateTag, {
    repoPath,
    name,
    ref,
    refKind,
    message
  })
}

export async function rpcDeleteTag(repoPath: string, name: string): Promise<RefWriteResult> {
  return callSidecarRpc(DeleteTag, { repoPath, name })
}

export async function rpcStashApply(
  repoPath: string,
  index: number,
  expectedOid: string
): Promise<ConflictableResult> {
  return callSidecarRpc(StashApply, { repoPath, index, expectedOid })
}

export async function rpcStashPop(
  repoPath: string,
  index: number,
  expectedOid: string
): Promise<ConflictableResult> {
  return callSidecarRpc(StashPop, { repoPath, index, expectedOid })
}

export async function rpcStashDrop(
  repoPath: string,
  index: number,
  expectedOid: string
): Promise<RefWriteResult> {
  return callSidecarRpc(StashDrop, { repoPath, index, expectedOid })
}

export async function rpcStashPush(
  repoPath: string,
  message?: string,
  includeUntracked?: boolean,
  files?: string[]
): Promise<GuardedWriteResult> {
  return callSidecarRpc(StashPush, {
    repoPath,
    message,
    includeUntracked,
    files
  })
}

export async function rpcReset(
  repoPath: string,
  sha: string,
  mode: ResetMode
): Promise<GuardedWriteResult> {
  return callSidecarRpc(Reset, { repoPath, sha, mode })
}

export async function rpcFetch(repoPath: string): Promise<FetchResult> {
  return callSidecarRpc(Fetch, { repoPath })
}

export async function rpcPush(
  repoPath: string,
  force?: PushForce,
  expectedRemoteSha?: string
): Promise<PushResult> {
  return callSidecarRpc(Push, { repoPath, force, expectedRemoteSha })
}

export async function rpcPull(repoPath: string): Promise<RefWriteResult> {
  return callSidecarRpc(Pull, { repoPath })
}

export async function rpcGetStatus(repoPath: string): Promise<StatusResult> {
  return callSidecarRpc(GetStatus, { repoPath })
}

export async function rpcGetLocalBranches(repoPath: string): Promise<LocalBranchesResult> {
  return callSidecarRpc(GetLocalBranches, { repoPath })
}

export async function rpcGetRemoteRefs(repoPath: string): Promise<RemoteRefsResult> {
  return callSidecarRpc(GetRemoteRefs, { repoPath })
}

export interface DiffScope {
  range?: string
  commit?: string
  renameSource?: string
}

export async function rpcGetDiff(
  repoPath: string,
  file: string,
  staged?: boolean,
  scope?: DiffScope
): Promise<DiffResult> {
  return callSidecarRpc(GetDiff, {
    repoPath,
    file,
    staged,
    range: scope?.range,
    commit: scope?.commit,
    renameSource: scope?.renameSource
  })
}

export async function rpcAbortOperation(repoPath: string): Promise<RefWriteResult> {
  return callSidecarRpc(AbortOperation, { repoPath })
}

export async function rpcContinueOperation(repoPath: string): Promise<ConflictableResult> {
  return callSidecarRpc(ContinueOperation, { repoPath })
}

export async function rpcResolveConflict(
  repoPath: string,
  file: string,
  side: ConflictSide
): Promise<StageResult> {
  return callSidecarRpc(ResolveConflict, { repoPath, file, side })
}

export async function rpcGetCommitDetail(
  repoPath: string,
  sha: string
): Promise<CommitDetailResult> {
  return callSidecarRpc(GetCommitDetail, { repoPath, sha })
}

export async function rpcStashList(repoPath: string): Promise<StashListResult> {
  return callSidecarRpc(StashList, { repoPath })
}
