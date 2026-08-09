import {
  AGENT_WIRE_DECODE_OPTIONS,
  AgentClaimRejected,
  ClaimAgentRequestSchema
} from '@common/features/agent-connection'
import { Effect, Result, Schema } from 'effect4'
import { type HttpServerRequest, HttpServerResponse } from 'effect4/unstable/http'
import type { AgentSession } from '../session/agent-session'
import { readRequestBody } from './request-body'

function json(status: number, payload: unknown): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(payload, {
    status,
    headers: { 'cache-control': 'no-store' }
  })
}

export function claimAgentRoute(
  request: HttpServerRequest.HttpServerRequest,
  session: AgentSession,
  maxRequestBytes: number
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const rawBody = yield* readRequestBody(request, maxRequestBytes)
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return json(400, new AgentClaimRejected({ reason: 'MalformedRequest' }))
    }
    const decoded = Schema.decodeUnknownResult(
      ClaimAgentRequestSchema,
      AGENT_WIRE_DECODE_OPTIONS
    )(parsed)
    if (Result.isFailure(decoded)) {
      return json(400, new AgentClaimRejected({ reason: 'MalformedRequest' }))
    }
    return yield* session.claim(decoded.success.bootstrapSecret).pipe(
      Effect.map((sessionToken) => json(200, { sessionToken })),
      Effect.catch((rejection) =>
        Effect.succeed(json(rejection.reason === 'AlreadyClaimed' ? 409 : 401, rejection))
      )
    )
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(json(413, new AgentClaimRejected({ reason: 'MalformedRequest' })))
    )
  )
}
