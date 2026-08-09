import {
  AGENT_RPC_PATH,
  type AgentRpc,
  AgentRpcs,
  CLAIM_AGENT_PATH
} from '@common/features/agent-connection'
import { Effect, Layer, type Scope } from 'effect4'
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from 'effect4/unstable/http'
import { type Rpc, RpcSerialization, RpcServer } from 'effect4/unstable/rpc'
import type { AgentConfiguration } from '../configuration'
import type { AgentLogger } from '../logging/redacted-agent-logger'
import type { AgentSession } from '../session/agent-session'
import { claimAgentRoute } from './bootstrap-route'
import { agentRpcRoute } from './rpc-route'

export function makeAgentHttpHandler(
  session: AgentSession,
  logger: AgentLogger,
  configuration: AgentConfiguration,
  handlersLayer: Layer.Layer<Rpc.ToHandler<AgentRpc>>
): Effect.Effect<(request: Request) => Promise<Response>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const serialization = RpcSerialization.makeNdjson({
      maxBufferSize: configuration.maxRequestBytes
    })
    const rpcRoutes = RpcServer.layerHttp({
      group: AgentRpcs,
      path: AGENT_RPC_PATH,
      protocol: 'http',
      disableFatalDefects: true
    }).pipe(
      Layer.provide(handlersLayer),
      Layer.provide(Layer.succeed(RpcSerialization.RpcSerialization, serialization))
    )
    const rpcWebHandler = yield* Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(rpcRoutes, { disableLogger: true })),
      ({ dispose }) => Effect.promise(dispose)
    )
    const application = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const pathname = new URL(request.originalUrl).pathname
      if (request.method === 'OPTIONS') {
        return HttpServerResponse.empty({ status: 403 })
      }
      if (pathname === CLAIM_AGENT_PATH && request.method === 'POST') {
        return yield* claimAgentRoute(request, session, configuration.maxRequestBytes)
      }
      if (pathname === AGENT_RPC_PATH && request.method === 'POST') {
        return yield* agentRpcRoute(
          request,
          session,
          configuration.maxRequestBytes,
          rpcWebHandler.handler
        )
      }
      return HttpServerResponse.jsonUnsafe(
        { _tag: 'AgentTransportRejected', reason: 'NotFound' },
        { status: 404, headers: { 'cache-control': 'no-store' } }
      )
    }).pipe(
      Effect.catchDefect((defect) =>
        logger
          .write('agent-request-failed', {
            error: defect instanceof Error ? defect.message : String(defect)
          })
          .pipe(
            Effect.as(
              HttpServerResponse.jsonUnsafe(
                { _tag: 'AgentTransportRejected', reason: 'InternalError' },
                { status: 500, headers: { 'cache-control': 'no-store' } }
              )
            )
          )
      )
    )
    return HttpEffect.toWebHandler(application)
  })
}
