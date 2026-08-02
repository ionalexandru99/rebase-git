import type { Rpc } from '@effect/rpc'
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
  GetCommitStats,
  GetDiff,
  GetHeadCommit,
  GetLocalBranches,
  GetRemoteRefs,
  GetStatus,
  GetWorkingTreeStats,
  type HunkLineSelection,
  MergeBranch,
  OpenRepo,
  Pull,
  Push,
  RebaseOnto,
  RenameBranch,
  Reset,
  ResolveConflict,
  RevertCommit,
  ScanForRepos,
  type SidecarRpc,
  StageAll,
  StageFile,
  StageHunk,
  StageLines,
  StashApply,
  StashDrop,
  StashList,
  StashPop,
  StashPush,
  UnstageAll,
  UnstageFile,
  UnstageHunk,
  UnstageLines
} from '@shared/rpc'
import { type RpcContract, type RpcResult, rpcResultSchema } from '@shared/rpc-result'
import type { RefKind, ResetMode } from '@shared/schemas/ipc'

type RpcResultFor<Contract extends Rpc.Any> = RpcResult<
  Rpc.SuccessExit<Contract>,
  Rpc.ErrorExit<Contract>
>

function decodeRpcResult<Success, SuccessInput, Failure, FailureInput>(
  contract: RpcContract<Success, SuccessInput, Failure, FailureInput>,
  payload: unknown
): RpcResult<Success, Failure> {
  return parseOrThrow(rpcResultSchema(contract), payload)
}

async function callSidecarRpc<Contract extends SidecarRpc>(
  contract: Contract,
  payload: Rpc.Payload<Contract>
): Promise<RpcResultFor<Contract>> {
  const response = await window.electronAPI.sidecarRequest(contract._tag, payload)
  const resultContract = contract as unknown as RpcContract<
    Rpc.SuccessExit<Contract>,
    Rpc.SuccessExitEncoded<Contract>,
    Rpc.ErrorExit<Contract>,
    Rpc.ErrorExitEncoded<Contract>
  >
  return decodeRpcResult(resultContract, response)
}

export type CommitPayload = Rpc.Payload<typeof Commit>
export type CommitResult = RpcResultFor<typeof Commit>
export type HeadCommitResult = RpcResultFor<typeof GetHeadCommit>
export type AmendResult = RpcResultFor<typeof AmendCommit>
export type OpenRepoResult = RpcResultFor<typeof OpenRepo>
export type ScanForReposResult = RpcResultFor<typeof ScanForRepos>
export type StageResult = RpcResultFor<typeof StageFile>
export type HunkResult = RpcResultFor<typeof StageHunk>
export type GuardedWriteResult = RpcResultFor<typeof UnstageFile>
export type GuardedHunkResult = RpcResultFor<typeof UnstageHunk>
export type ConflictableResult = RpcResultFor<typeof MergeBranch>
export type RefWriteResult = RpcResultFor<typeof DeleteBranch>
export type PushResult = RpcResultFor<typeof Push>
export type PushForce = NonNullable<Rpc.Payload<typeof Push>['force']>
export type PullResult = RpcResultFor<typeof Pull>
export type PullStrategy = NonNullable<Rpc.Payload<typeof Pull>['strategy']>
export type ConflictSide = Rpc.Payload<typeof ResolveConflict>['side']
export type CheckoutResult = RpcResultFor<typeof Checkout>
export type FetchResult = RpcResultFor<typeof Fetch>
export type StatusResult = RpcResultFor<typeof GetStatus>
export type LocalBranchesResult = RpcResultFor<typeof GetLocalBranches>
export type RemoteRefsResult = RpcResultFor<typeof GetRemoteRefs>
export type DiffResult = RpcResultFor<typeof GetDiff>
export type CommitDetailResult = RpcResultFor<typeof GetCommitDetail>
export type CommitStatsResult = RpcResultFor<typeof GetCommitStats>
export type WorkingTreeStatsResult = RpcResultFor<typeof GetWorkingTreeStats>
export type StashListResult = RpcResultFor<typeof StashList>

export async function rpcOpenRepo(repoPath: string, owner: number): Promise<OpenRepoResult> {
  return decodeRpcResult(OpenRepo, await window.electronAPI.openRepo(repoPath, owner))
}

export async function rpcCloseRepo(repoPath: string, owner: number): Promise<void> {
  await window.electronAPI.closeRepo(repoPath, owner)
}

export async function rpcDisownRepo(repoPath: string, owner: number): Promise<void> {
  await window.electronAPI.disownRepo(repoPath, owner)
}

export async function rpcScanForRepos(dirPath: string): Promise<ScanForReposResult> {
  return decodeRpcResult(ScanForRepos, await window.electronAPI.scanForRepos(dirPath))
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
): Promise<GuardedHunkResult> {
  return callSidecarRpc(DiscardHunk, {
    repoPath,
    file,
    hunkHeader
  })
}

export async function rpcStageLines(
  repoPath: string,
  file: string,
  selections: readonly HunkLineSelection[]
): Promise<HunkResult> {
  return callSidecarRpc(StageLines, { repoPath, file, selections })
}

export async function rpcUnstageLines(
  repoPath: string,
  file: string,
  selections: readonly HunkLineSelection[]
): Promise<GuardedHunkResult> {
  return callSidecarRpc(UnstageLines, { repoPath, file, selections })
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

export async function rpcRebaseOnto(
  repoPath: string,
  refKind: RefKind,
  fullPath: string
): Promise<ConflictableResult> {
  return callSidecarRpc(RebaseOnto, { repoPath, refKind, fullPath })
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

export async function rpcPull(repoPath: string, strategy?: PullStrategy): Promise<PullResult> {
  return callSidecarRpc(Pull, { repoPath, strategy })
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

export async function rpcGetCommitStats(
  repoPath: string,
  shas: readonly string[]
): Promise<CommitStatsResult> {
  return callSidecarRpc(GetCommitStats, { repoPath, shas })
}

export async function rpcGetWorkingTreeStats(repoPath: string): Promise<WorkingTreeStatsResult> {
  return callSidecarRpc(GetWorkingTreeStats, { repoPath })
}

export async function rpcStashList(repoPath: string): Promise<StashListResult> {
  return callSidecarRpc(StashList, { repoPath })
}
