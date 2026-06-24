import { parseOrThrow } from '@shared/codec'
import {
  Checkout,
  CherryPick,
  Commit,
  Conflict,
  CreateBranch,
  CreateTag,
  DeleteBranch,
  DeleteTag,
  DiscardAll,
  DiscardChanges,
  Fetch,
  FetchSkipped,
  GitError,
  HunkNotFound,
  MergeBranch,
  NotARepo,
  OpenRepo,
  Pull,
  Push,
  RenameBranch,
  RepoNotOpen,
  Reset,
  RevertCommit,
  ScanForRepos,
  StageAll,
  StageFile,
  StageHunk,
  StashApply,
  StashDrop,
  StashPop,
  StashPush,
  UnstageAll,
  UnstageFile,
  UnstageHunk
} from '@shared/rpc'
import type { RefKind, ResetMode } from '@shared/schemas/ipc'
import { Schema } from 'effect'

// The renderer↔main wire envelope for a typed RPC op: the op's success value tagged `Ok`, or one of
// the contract's domain errors as data. Both halves are derived from the `Commit` Rpc itself so the
// call site never hand-passes a response schema or restates the shape.
const CommitResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }).pipe(Schema.extend(Commit.successSchema)),
  RepoNotOpen,
  GitError
)

// open/close/scan reach the sidecar through their own main-process channels (not sidecarRequest)
// because main sequences the file watcher + recent-repo store around the call, but the renderer's
// result is still the op's contract: open's `Ok` carries the open result and routes `NotARepo`;
// scan's `Ok` carries the repo list; close is the bare `Ok` tag (the op is infallible).
const OpenRepoResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }).pipe(Schema.extend(OpenRepo.successSchema)),
  NotARepo,
  GitError
)
const ScanForReposResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }).pipe(Schema.extend(ScanForRepos.successSchema)),
  GitError
)

// The void-returning write ops carry no payload on success, so `Ok` is the bare tag; the hunk ops
// add the typed `HunkNotFound` outcome on top of the shared stage error union.
const StageResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }),
  RepoNotOpen,
  GitError
)
const HunkResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }),
  HunkNotFound,
  RepoNotOpen,
  GitError
)

// merge/revert/cherry-pick can leave the tree conflicted, so they add the typed `Conflict` outcome
// (a domain result the renderer routes to the resolve path) on top of the shared stage error union.
const ConflictableResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }),
  Conflict,
  RepoNotOpen,
  GitError
)

// Branch create/delete/rename and tag create/delete are void writes with no Conflict arm — their
// success is the bare `Ok` tag and the only domain failures are RepoNotOpen/GitError.
const RefWriteResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }),
  RepoNotOpen,
  GitError
)

// Checkout returns the name it actually switched to; its `Ok` carries that payload, derived from the
// contract so the shape is never restated here.
const CheckoutResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }).pipe(Schema.extend(Checkout.successSchema)),
  RepoNotOpen,
  GitError
)

// Fetch can decline to run when one is already in flight, surfacing the typed `FetchSkipped` outcome
// (a benign domain result the caller treats as a no-op) on top of the shared read error union.
const FetchResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }),
  FetchSkipped,
  RepoNotOpen,
  GitError
)

export type CommitPayload = typeof Commit.payloadSchema.Type
export type CommitResult = typeof CommitResult.Type
export type OpenRepoResult = typeof OpenRepoResult.Type
export type ScanForReposResult = typeof ScanForReposResult.Type
export type StageResult = typeof StageResult.Type
export type HunkResult = typeof HunkResult.Type
export type ConflictableResult = typeof ConflictableResult.Type
export type RefWriteResult = typeof RefWriteResult.Type
export type CheckoutResult = typeof CheckoutResult.Type
export type FetchResult = typeof FetchResult.Type

export async function rpcOpenRepo(repoPath: string): Promise<OpenRepoResult> {
  return parseOrThrow(OpenRepoResult, await window.electronAPI.openRepo(repoPath))
}

export async function rpcCloseRepo(repoPath: string): Promise<void> {
  await window.electronAPI.closeRepo(repoPath)
}

export async function rpcScanForRepos(dirPath: string): Promise<ScanForReposResult> {
  return parseOrThrow(ScanForReposResult, await window.electronAPI.scanForRepos(dirPath))
}

export async function rpcCommit(repoPath: string, message: string): Promise<CommitResult> {
  const payload = await window.electronAPI.sidecarRequest(Commit._tag, { repoPath, message })
  return parseOrThrow(CommitResult, payload)
}

export async function rpcStageFile(repoPath: string, file: string): Promise<StageResult> {
  const payload = await window.electronAPI.sidecarRequest(StageFile._tag, { repoPath, file })
  return parseOrThrow(StageResult, payload)
}

export async function rpcUnstageFile(repoPath: string, file: string): Promise<StageResult> {
  const payload = await window.electronAPI.sidecarRequest(UnstageFile._tag, { repoPath, file })
  return parseOrThrow(StageResult, payload)
}

export async function rpcStageAll(repoPath: string, files: string[]): Promise<StageResult> {
  const payload = await window.electronAPI.sidecarRequest(StageAll._tag, { repoPath, files })
  return parseOrThrow(StageResult, payload)
}

export async function rpcUnstageAll(repoPath: string, files: string[]): Promise<StageResult> {
  const payload = await window.electronAPI.sidecarRequest(UnstageAll._tag, { repoPath, files })
  return parseOrThrow(StageResult, payload)
}

export async function rpcStageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<HunkResult> {
  const payload = await window.electronAPI.sidecarRequest(StageHunk._tag, {
    repoPath,
    file,
    hunkHeader
  })
  return parseOrThrow(HunkResult, payload)
}

export async function rpcUnstageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<HunkResult> {
  const payload = await window.electronAPI.sidecarRequest(UnstageHunk._tag, {
    repoPath,
    file,
    hunkHeader
  })
  return parseOrThrow(HunkResult, payload)
}

export async function rpcDiscardChanges(repoPath: string, files: string[]): Promise<StageResult> {
  const payload = await window.electronAPI.sidecarRequest(DiscardChanges._tag, { repoPath, files })
  return parseOrThrow(StageResult, payload)
}

export async function rpcDiscardAll(repoPath: string): Promise<StageResult> {
  const payload = await window.electronAPI.sidecarRequest(DiscardAll._tag, { repoPath })
  return parseOrThrow(StageResult, payload)
}

export async function rpcMergeBranch(repoPath: string, ref: string): Promise<ConflictableResult> {
  const payload = await window.electronAPI.sidecarRequest(MergeBranch._tag, { repoPath, ref })
  return parseOrThrow(ConflictableResult, payload)
}

export async function rpcRevertCommit(repoPath: string, sha: string): Promise<ConflictableResult> {
  const payload = await window.electronAPI.sidecarRequest(RevertCommit._tag, { repoPath, sha })
  return parseOrThrow(ConflictableResult, payload)
}

export async function rpcCherryPick(repoPath: string, sha: string): Promise<ConflictableResult> {
  const payload = await window.electronAPI.sidecarRequest(CherryPick._tag, { repoPath, sha })
  return parseOrThrow(ConflictableResult, payload)
}

export async function rpcCheckout(
  repoPath: string,
  refKind: RefKind,
  fullPath: string
): Promise<CheckoutResult> {
  const payload = await window.electronAPI.sidecarRequest(Checkout._tag, {
    repoPath,
    refKind,
    fullPath
  })
  return parseOrThrow(CheckoutResult, payload)
}

export async function rpcCreateBranch(
  repoPath: string,
  name: string,
  startPoint?: string,
  checkout?: boolean
): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(CreateBranch._tag, {
    repoPath,
    name,
    startPoint,
    checkout
  })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcDeleteBranch(
  repoPath: string,
  name: string,
  force?: boolean
): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(DeleteBranch._tag, {
    repoPath,
    name,
    force
  })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcRenameBranch(
  repoPath: string,
  oldName: string,
  newName: string
): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(RenameBranch._tag, {
    repoPath,
    oldName,
    newName
  })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcCreateTag(
  repoPath: string,
  name: string,
  ref?: string,
  message?: string
): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(CreateTag._tag, {
    repoPath,
    name,
    ref,
    message
  })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcDeleteTag(repoPath: string, name: string): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(DeleteTag._tag, { repoPath, name })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcStashApply(repoPath: string, index: number): Promise<ConflictableResult> {
  const payload = await window.electronAPI.sidecarRequest(StashApply._tag, { repoPath, index })
  return parseOrThrow(ConflictableResult, payload)
}

export async function rpcStashPop(repoPath: string, index: number): Promise<ConflictableResult> {
  const payload = await window.electronAPI.sidecarRequest(StashPop._tag, { repoPath, index })
  return parseOrThrow(ConflictableResult, payload)
}

export async function rpcStashDrop(repoPath: string, index: number): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(StashDrop._tag, { repoPath, index })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcStashPush(
  repoPath: string,
  message?: string,
  includeUntracked?: boolean,
  files?: string[]
): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(StashPush._tag, {
    repoPath,
    message,
    includeUntracked,
    files
  })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcReset(
  repoPath: string,
  sha: string,
  mode: ResetMode
): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(Reset._tag, { repoPath, sha, mode })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcFetch(repoPath: string): Promise<FetchResult> {
  const payload = await window.electronAPI.sidecarRequest(Fetch._tag, { repoPath })
  return parseOrThrow(FetchResult, payload)
}

export async function rpcPush(repoPath: string): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(Push._tag, { repoPath })
  return parseOrThrow(RefWriteResult, payload)
}

export async function rpcPull(repoPath: string): Promise<RefWriteResult> {
  const payload = await window.electronAPI.sidecarRequest(Pull._tag, { repoPath })
  return parseOrThrow(RefWriteResult, payload)
}
