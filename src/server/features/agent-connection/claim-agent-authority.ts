import {
  AGENT_LOOPBACK_HOST,
  AGENT_WIRE_DECODE_OPTIONS,
  type AgentReadyRecord,
  CLAIM_AGENT_PATH,
  ClaimAgentFailureSchema,
  ClaimAgentSuccessSchema
} from '@common/features/agent-connection'
import { Cause, Effect, Schema } from 'effect4'
import { type HttpClient, HttpClientRequest } from 'effect4/unstable/http'
import { AgentConnectionFailure } from './agent-connection-failure'

function malformedBootstrap(message: string, detail: unknown): AgentConnectionFailure {
  return new AgentConnectionFailure({
    reason: 'MalformedBootstrap',
    message,
    detail
  })
}

function safeBootstrapFailureDetail(error: unknown, bootstrapSecret: string) {
  if (!(error instanceof Error)) {
    return { kind: typeof error }
  }
  return {
    kind: error.name,
    message: error.message.replaceAll(bootstrapSecret, '[redacted]')
  }
}

export function claimAgentAuthority(
  ready: AgentReadyRecord,
  client: HttpClient.HttpClient,
  timeoutMs: number
): Effect.Effect<string, AgentConnectionFailure> {
  const request = HttpClientRequest.post(
    `http://${AGENT_LOOPBACK_HOST}:${ready.port}${CLAIM_AGENT_PATH}`
  ).pipe(HttpClientRequest.bodyJsonUnsafe({ bootstrapSecret: ready.bootstrapSecret }))

  return Effect.gen(function* () {
    const response = yield* client.execute(request)
    const body = yield* response.json.pipe(
      Effect.mapError((detail) =>
        malformedBootstrap('Agent bootstrap response is not valid JSON', detail)
      )
    )

    if (response.status < 200 || response.status >= 300) {
      const rejected = yield* Schema.decodeUnknownEffect(
        ClaimAgentFailureSchema,
        AGENT_WIRE_DECODE_OPTIONS
      )(body).pipe(
        Effect.mapError((detail) =>
          malformedBootstrap('Agent bootstrap rejection does not match the Agent interface', detail)
        )
      )
      return yield* Effect.fail(
        new AgentConnectionFailure({
          reason: 'BootstrapRejected',
          message: `Agent bootstrap was rejected: ${rejected.reason}`,
          detail: rejected
        })
      )
    }

    const claimed = yield* Schema.decodeUnknownEffect(
      ClaimAgentSuccessSchema,
      AGENT_WIRE_DECODE_OPTIONS
    )(body).pipe(
      Effect.mapError((detail) =>
        malformedBootstrap('Agent bootstrap response does not match the Agent interface', detail)
      )
    )
    return claimed.sessionToken
  }).pipe(
    Effect.timeout(timeoutMs),
    Effect.mapError((error) => {
      if (error instanceof AgentConnectionFailure) {
        return error
      }
      return new AgentConnectionFailure({
        reason: 'BootstrapOutcomeUnknown',
        message: Cause.isTimeoutError(error)
          ? 'Agent bootstrap timed out after dispatch may have begun'
          : 'Agent bootstrap failed after dispatch may have begun',
        detail: safeBootstrapFailureDetail(error, ready.bootstrapSecret)
      })
    })
  )
}
