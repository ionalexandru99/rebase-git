import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { type RpcReadOp, rpcReadOps, SidecarRpcs } from '@shared/rpc'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect'

type ReadResponse =
  | ({ _tag: 'Ok' } & Record<string, unknown>)
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }

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

// Routes a read op through the sidecar's @effect/rpc group: the typed RPC error channel is mapped
// back onto the `_tag` response union the renderer's registry schemas already validate.
export async function callRpcRead(
  op: RpcReadOp,
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<ReadResponse> {
  const runtime = runtimeFor(baseUrl, token)
  const tag = rpcReadOps[op]
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
  if (Exit.isSuccess(exit)) {
    return { _tag: 'Ok', ...(exit.value as Record<string, unknown>) }
  }
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) {
    const error = failure.value as { _tag?: string; message?: string }
    if (error._tag === 'RepoNotOpen') {
      return { _tag: 'RepoNotOpen' }
    }
    return { _tag: 'GitError', message: error.message ?? `git ${op} failed` }
  }
  return { _tag: 'GitError', message: Cause.pretty(exit.cause) }
}
