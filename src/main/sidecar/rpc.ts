import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import {
  CloseRepo,
  OpenRepo,
  ScanForRepos,
  type SidecarRpcErrorResponse,
  type SidecarRpcResponse,
  SidecarRpcs,
  StreamLog
} from '@shared/rpc'
import type { LogChunk } from '@shared/schemas/git'
import { Cause, Effect, Either, Exit, Layer, ManagedRuntime, Option, Schema, Stream } from 'effect'

const rpcTags = new Set(SidecarRpcs.requests.keys())
const ownedRpcTags: ReadonlySet<string> = new Set([
  OpenRepo._tag,
  CloseRepo._tag,
  ScanForRepos._tag,
  StreamLog._tag
])
const RPC_TIMEOUT_MS = 120_000

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

export function isRendererRpcOp(op: string): boolean {
  return isRpcOp(op) && !ownedRpcTags.has(op)
}

export class SidecarRpcError extends Error {
  override readonly name = 'SidecarRpcError'
  constructor(op: string) {
    super(`sidecar RPC '${op}' failed`)
  }
}

const scrubToken = (text: string, token: string): string =>
  token ? text.split(token).join('***') : text

const encodeRpcError = (
  op: string,
  error: unknown,
  token: string
): SidecarRpcErrorResponse | undefined => {
  const rpc = SidecarRpcs.requests.get(op)
  if (!rpc) {
    return undefined
  }
  const encoded = Schema.encodeUnknownEither(
    rpc.errorSchema as Schema.Schema<unknown, unknown, never>
  )(error)
  if (Either.isLeft(encoded)) {
    return undefined
  }
  const response = encoded.right as SidecarRpcErrorResponse
  if ('message' in response && typeof response.message === 'string') {
    return { ...response, message: scrubToken(response.message, token) }
  }
  return response
}

export function classifyExit(
  op: string,
  exit: Exit.Exit<unknown, unknown>,
  token: string
): SidecarRpcResponse {
  if (Exit.isSuccess(exit)) {
    return { _tag: 'Ok', ...(exit.value as Record<string, unknown>) } as SidecarRpcResponse
  }
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    const response = encodeRpcError(op, failure.value, token)
    if (response) {
      return response
    }
  }
  console.error(`[sidecar-rpc] ${op} failed`, scrubToken(Cause.pretty(exit.cause), token))
  throw new SidecarRpcError(op)
}

async function runRpcTag(
  tag: string,
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>,
  options?: RpcCallOptions
): Promise<SidecarRpcResponse> {
  const runtime = makeRuntime(baseUrl, token)
  const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? RPC_TIMEOUT_MS)
  const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
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
      ),
      { signal }
    )
    return classifyExit(tag, exit, token)
  } finally {
    await runtime.dispose()
  }
}

export interface RpcCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export async function callRpcByTag(
  tag: string,
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>,
  options?: RpcCallOptions
): Promise<SidecarRpcResponse> {
  return runRpcTag(tag, baseUrl, token, payload, options)
}

export interface StreamLogPayload {
  repoPath: string
  skip?: number
  maxCount?: number
  streamId?: number
}

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
    await runtime.dispose()
  }
}
