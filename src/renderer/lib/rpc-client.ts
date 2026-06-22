import { parseOrThrow } from '@shared/codec'
import {
  Commit,
  DiscardAll,
  DiscardChanges,
  GitError,
  HunkNotFound,
  RepoNotOpen,
  StageAll,
  StageFile,
  StageHunk,
  UnstageAll,
  UnstageFile,
  UnstageHunk
} from '@shared/rpc'
import { Schema } from 'effect'

// The renderer↔main wire envelope for a typed RPC op: the op's success value tagged `Ok`, or one of
// the contract's domain errors as data. Both halves are derived from the `Commit` Rpc itself so the
// call site never hand-passes a response schema or restates the shape.
const CommitResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }).pipe(Schema.extend(Commit.successSchema)),
  RepoNotOpen,
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

export type CommitPayload = typeof Commit.payloadSchema.Type
export type CommitResult = typeof CommitResult.Type
export type StageResult = typeof StageResult.Type
export type HunkResult = typeof HunkResult.Type

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
