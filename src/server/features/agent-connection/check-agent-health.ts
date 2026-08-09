import { Effect } from 'effect4'
import type { AgentConnectionFailure } from './agent-connection-failure'
import type { AgentLiveness } from './agent-liveness'
import {
  classifyAgentCommunicationFailure,
  isRecoverableAgentCommunicationFailure,
  malformedAgentCommunication,
  shouldDisconnectAfterCommunicationFailure
} from './classify-agent-communication-failure'
import type { AgentInterfaceClient } from './establish-agent-session'

export function checkAgentHealth(
  client: AgentInterfaceClient,
  liveness: AgentLiveness,
  requestId: string,
  timeoutMs: number,
  retries: number
): Effect.Effect<number, AgentConnectionFailure> {
  const attempt = liveness
    .whileConnected(
      client.pingAgent({ requestId }).pipe(
        Effect.timeout(timeoutMs),
        Effect.catchDefect((detail) =>
          Effect.fail(malformedAgentCommunication(detail, 'Agent health check'))
        )
      )
    )
    .pipe(
      Effect.mapError((error) => classifyAgentCommunicationFailure(error, 'Agent health check')),
      Effect.map((response) => response.sequence)
    )

  return attempt.pipe(
    Effect.retry({ times: retries, while: isRecoverableAgentCommunicationFailure }),
    Effect.tapError((failure) =>
      shouldDisconnectAfterCommunicationFailure(failure)
        ? liveness.disconnect({ _tag: 'Unreachable', failure })
        : Effect.void
    )
  )
}
