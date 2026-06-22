import { parseOrThrow } from '@shared/codec'
import { Commit, GitError, RepoNotOpen } from '@shared/rpc'
import { Schema } from 'effect'

// The renderer↔main wire envelope for a typed RPC op: the op's success value tagged `Ok`, or one of
// the contract's domain errors as data. Both halves are derived from the `Commit` Rpc itself so the
// call site never hand-passes a response schema or restates the shape.
const CommitResult = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal('Ok') }).pipe(Schema.extend(Commit.successSchema)),
  RepoNotOpen,
  GitError
)

export type CommitPayload = typeof Commit.payloadSchema.Type
export type CommitResult = typeof CommitResult.Type

export async function rpcCommit(repoPath: string, message: string): Promise<CommitResult> {
  const payload = await window.electronAPI.sidecarRequest(Commit._tag, { repoPath, message })
  return parseOrThrow(CommitResult, payload)
}
