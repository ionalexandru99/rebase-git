import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { type RpcReadOp, type RpcWriteOp, rpcReadOps, rpcWriteOps, SidecarRpcs } from '@shared/rpc'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect'

type RpcOp = RpcReadOp | RpcWriteOp
const rpcTags: Record<string, string> = { ...rpcReadOps, ...rpcWriteOps }

// The renderer↔main wire shape for an RPC op: the typed success/domain errors as data; every
// infrastructure failure rejects the call instead (see callRpc / SidecarRpcError).
type RpcResponse =
  | ({ _tag: 'Ok' } & Record<string, unknown>)
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }
  | { _tag: 'HunkNotFound' }
  | { _tag: 'FetchSkipped' }
  | { _tag: 'Conflict'; message: string }

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

type SidecarRuntime = ReturnType<typeof makeRuntime>

let cached: { key: string; runtime: SidecarRuntime } | null = null

function runtimeFor(baseUrl: string, token: string): SidecarRuntime {
  const key = `${baseUrl}|${token}`
  if (cached?.key === key) {
    return cached.runtime
  }
  if (cached) {
    void cached.runtime.dispose()
  }
  const runtime = makeRuntime(baseUrl, token)
  cached = { key, runtime }
  return runtime
}

export function disposeRpcRuntime(): void {
  if (cached) {
    void cached.runtime.dispose()
    cached = null
  }
}

export function isRpcReadOp(op: string): op is RpcReadOp {
  return op in rpcReadOps
}

export function isRpcWriteOp(op: string): op is RpcWriteOp {
  return op in rpcWriteOps
}

export function isRpcOp(op: string): op is RpcOp {
  return op in rpcTags
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
  }
  console.error(`[sidecar-rpc] ${op} failed`, scrubToken(Cause.pretty(exit.cause), token))
  throw new SidecarRpcError(op)
}

// Routes a read or write op through the sidecar's @effect/rpc group; see classifyExit for how the
// typed RPC error channel maps back onto the renderer's `_tag` response union.
export async function callRpc(
  op: RpcOp,
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<RpcResponse> {
  const runtime = runtimeFor(baseUrl, token)
  const tag = rpcTags[op]
  const exit = await runtime.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(SidecarRpcs)
        const method = (
          client as Record<string, (input: unknown) => Effect.Effect<unknown, unknown>>
        )[tag]
        return yield* method(payload)
      })
    )
  )
  return classifyExit(op, exit, token)
}
