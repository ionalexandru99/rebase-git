import { Effect } from 'effect4'
import { type HttpServerRequest, HttpServerResponse } from 'effect4/unstable/http'
import type { AgentSession } from '../session/agent-session'
import { readRequestBody } from './request-body'
import { validateRpcRequest } from './validate-rpc-request'

function rejected(
  status: number,
  reason: 'InternalError' | 'MalformedRpc' | 'RequestTooLarge' | 'Unauthorized'
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(
    { _tag: 'AgentTransportRejected', reason },
    { status, headers: { 'cache-control': 'no-store' } }
  )
}

export function agentRpcRoute(
  request: HttpServerRequest.HttpServerRequest,
  session: AgentSession,
  maxRequestBytes: number,
  rpcHandler: (request: Request) => Promise<Response>
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const authorized = yield* session.authorize(request.headers.authorization)
    if (!authorized) {
      return rejected(401, 'Unauthorized')
    }
    const rawBody = yield* readRequestBody(request, maxRequestBytes)
    const rejection = validateRpcRequest(rawBody)
    if (rejection) {
      return HttpServerResponse.jsonUnsafe(
        { _tag: 'AgentTransportRejected', reason: rejection },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      )
    }
    const source = request.source instanceof Request ? request.source : undefined
    const rpcRequest = new Request(request.originalUrl, {
      method: 'POST',
      headers: request.headers,
      body: rawBody,
      signal: source?.signal
    })
    return HttpServerResponse.fromWeb(yield* Effect.promise(() => rpcHandler(rpcRequest)))
  }).pipe(
    Effect.catch((failure) =>
      Effect.succeed(rejected(failure === 'RequestTooLarge' ? 413 : 500, failure))
    )
  )
}
