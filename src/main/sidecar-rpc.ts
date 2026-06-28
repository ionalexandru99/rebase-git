import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { SidecarRpcs } from '@shared/rpc'
import type { LogChunk } from '@shared/schemas/git'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Stream } from 'effect'

const rpcTags = new Set(SidecarRpcs.requests.keys())

// The renderer↔main wire shape for an RPC op: the typed success/domain errors as data; every
// infrastructure failure rejects the call instead (see callRpc / SidecarRpcError).
type LostCommit = { sha: string; subject: string }

type RpcResponse =
  | ({ _tag: 'Ok' } & Record<string, unknown>)
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'NotARepo' }
  | { _tag: 'GitError'; message: string }
  | { _tag: 'HunkNotFound' }
  | { _tag: 'FetchSkipped' }
  | { _tag: 'Conflict'; message: string }
  | {
      _tag: 'PushRejected'
      reason: string
      lostCommits: readonly LostCommit[]
      remoteSha?: string
    }
  | { _tag: 'AmendRejected'; reason: string }

const makeRuntime = (baseUrl: string, token: string) => {
  const protocol = RpcClient.layerProtocolHttp({
    url: `${baseUrl}/rpc`,
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, 'authorization', `Bearer ${token}`)
      )
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))
  return ManagedRuntime.make(protocol)
}

export function isRpcOp(op: string): boolean {
  return rpcTags.has(op)
}

// Thrown for anything that is NOT a typed domain failure (transport error, RPC decode failure,
// schema/contract drift, defect, interrupt). It rejects the IPC call so the renderer surfaces an
// error rather than parsing it as a normal Git result, and carries no cause detail (which could
// embed the bearer token) across the process boundary.
export class SidecarRpcError extends Error {
  override readonly name = 'SidecarRpcError'
  constructor(op: string) {
    super(`sidecar RPC '${op}' failed`)
  }
}

const isTaggedError = (value: unknown, tag: string): boolean =>
  typeof value === 'object' && value !== null && (value as { _tag?: unknown })._tag === tag

const scrubToken = (text: string, token: string): string =>
  token ? text.split(token).join('***') : text

// Maps an RPC Exit back onto the legacy `_tag` response union — but ONLY for the typed domain
// errors (`RepoNotOpen`, `GitError`) that the renderer's response schemas validate. Every other
// cause throws `SidecarRpcError`: collapsing them into `{ _tag: 'GitError' }` would let the
// renderer treat infrastructure/contract failures as ordinary Git errors.
export function classifyExit(
  op: string,
  exit: Exit.Exit<unknown, unknown>,
  token: string
): RpcResponse {
  if (Exit.isSuccess(exit)) {
    return { _tag: 'Ok', ...(exit.value as Record<string, unknown>) }
  }
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    const error = failure.value
    if (isTaggedError(error, 'RepoNotOpen')) {
      return { _tag: 'RepoNotOpen' }
    }
    if (isTaggedError(error, 'NotARepo')) {
      return { _tag: 'NotARepo' }
    }
    if (isTaggedError(error, 'HunkNotFound')) {
      return { _tag: 'HunkNotFound' }
    }
    if (isTaggedError(error, 'FetchSkipped')) {
      return { _tag: 'FetchSkipped' }
    }
    const message = (error as { message?: unknown }).message
    if (isTaggedError(error, 'Conflict') && typeof message === 'string') {
      return { _tag: 'Conflict', message: scrubToken(message, token) }
    }
    if (isTaggedError(error, 'GitError') && typeof message === 'string') {
      return { _tag: 'GitError', message: scrubToken(message, token) }
    }
    if (isTaggedError(error, 'PushRejected')) {
      const rejected = error as {
        reason: string
        lostCommits: readonly LostCommit[]
        remoteSha?: string
      }
      return {
        _tag: 'PushRejected',
        reason: rejected.reason,
        lostCommits: rejected.lostCommits,
        remoteSha: rejected.remoteSha
      }
    }
    if (isTaggedError(error, 'AmendRejected')) {
      return { _tag: 'AmendRejected', reason: (error as { reason: string }).reason }
    }
  }
  console.error(`[sidecar-rpc] ${op} failed`, scrubToken(Cause.pretty(exit.cause), token))
  throw new SidecarRpcError(op)
}

async function runRpcTag(
  tag: string,
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<RpcResponse> {
  // A shared runtime can leave concurrent Electron IPC reads waiting after the sidecar responds.
  const runtime = makeRuntime(baseUrl, token)
  try {
    const exit = await runtime.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(SidecarRpcs)
          const method = (
            client as unknown as Record<string, (input: unknown) => Effect.Effect<unknown, unknown>>
          )[tag]
          return yield* method(payload)
        })
      )
    )
    return classifyExit(tag, exit, token)
  } finally {
    void runtime.dispose()
  }
}

export async function callRpcByTag(
  tag: string,
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<RpcResponse> {
  return runRpcTag(tag, baseUrl, token, payload)
}

export interface StreamLogPayload {
  repoPath: string
  skip?: number
  maxCount?: number
  streamId?: number
}

// Drives the streaming `streamLog` RPC, invoking onChunk per delivered LogChunk. Aborting the signal
// interrupts the stream — which cancels the underlying `git log` on the sidecar — and resolves quietly
// (no throw), so a superseded stream is silent. Any real failure rejects with the scrubbed message,
// which the IPC layer turns into a terminal error chunk for the renderer.
export async function runStreamLog(
  baseUrl: string,
  token: string,
  payload: StreamLogPayload,
  signal: AbortSignal,
  onChunk: (chunk: LogChunk) => void
): Promise<void> {
  const runtime = makeRuntime(baseUrl, token)
  try {
    const exit = await runtime.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(SidecarRpcs)
          yield* Stream.runForEach(client.streamLog(payload), (chunk) =>
            Effect.sync(() => onChunk(chunk))
          )
        })
      ),
      { signal }
    )
    if (Exit.isSuccess(exit) || Exit.isInterrupted(exit)) {
      return
    }
    const failure = Cause.failureOption(exit.cause)
    const message =
      Option.isSome(failure) && typeof (failure.value as { message?: unknown }).message === 'string'
        ? (failure.value as { message: string }).message
        : 'sidecar log stream failed'
    throw new Error(scrubToken(message, token))
  } finally {
    void runtime.dispose()
  }
}
