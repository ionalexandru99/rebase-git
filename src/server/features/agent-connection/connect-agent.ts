import { AGENT_LOOPBACK_HOST, type AgentReadyRecord } from '@common/features/agent-connection'
import { Effect, type Scope } from 'effect4'
import { FetchHttpClient, HttpClient } from 'effect4/unstable/http'
import type { AgentConnection, ConnectAgentOptions } from './agent-connection'
import type { AgentConnectionFailure } from './agent-connection-failure'
import { acquireAgentLiveness } from './agent-liveness'
import { checkAgentHealth } from './check-agent-health'
import { claimAgentAuthority } from './claim-agent-authority'
import { dispatchAgentShutdown } from './dispatch-agent-shutdown'
import { establishAgentSession } from './establish-agent-session'
import { observeAgentActivity } from './observe-agent-activity'

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const DEFAULT_SAFE_QUERY_RETRIES = 1
const DEFAULT_STREAM_RECONNECTS = 3
const DEFAULT_STREAM_RECONNECT_DELAY_MS = 25

export function connectAgent(
  ready: AgentReadyRecord,
  options: ConnectAgentOptions
): Effect.Effect<AgentConnection, AgentConnectionFailure, Scope.Scope> {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const safeQueryRetries = options.safeQueryRetries ?? DEFAULT_SAFE_QUERY_RETRIES
  const streamReconnects = options.streamReconnects ?? DEFAULT_STREAM_RECONNECTS
  const streamReconnectDelayMs = options.streamReconnectDelayMs ?? DEFAULT_STREAM_RECONNECT_DELAY_MS

  return Effect.gen(function* () {
    const liveness = yield* acquireAgentLiveness(options.agentExited)
    const httpClient = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
    const sessionToken = yield* liveness.whileConnected(
      claimAgentAuthority(ready, httpClient, requestTimeoutMs)
    )
    const baseUrl = `http://${AGENT_LOOPBACK_HOST}:${ready.port}`
    const session = yield* establishAgentSession(
      baseUrl,
      sessionToken,
      httpClient,
      liveness,
      requestTimeoutMs
    )

    return {
      compatibility: session.compatibility,
      status: liveness.status,
      ping: (requestId) =>
        checkAgentHealth(session.client, liveness, requestId, requestTimeoutMs, safeQueryRetries),
      agentActivity: observeAgentActivity(
        session.client,
        liveness,
        session.compatibility.limits.streamBufferEvents,
        streamReconnects,
        streamReconnectDelayMs
      ),
      shutdown: (operationId) =>
        dispatchAgentShutdown(session.client, liveness, operationId, requestTimeoutMs)
    }
  })
}
