import { RepositoryPathRejected } from '@common/features/agent-connection'
import { Effect } from 'effect4'
import type { AgentConnectionFailure } from './failure/agent-connection-failure'
import {
  classifyAgentCommunicationFailure,
  isRecoverableAgentCommunicationFailure,
  malformedAgentCommunication,
  shouldDisconnectAfterCommunicationFailure
} from './failure/classify-agent-communication-failure'
import type { AgentLiveness } from './lifecycle/agent-liveness'
import type { AgentInterfaceClient } from './session/establish-agent-session'

export function authorizeRepositoryPath(
  client: AgentInterfaceClient,
  liveness: AgentLiveness,
  nativePath: string,
  timeoutMs: number,
  retries: number
): Effect.Effect<string, AgentConnectionFailure | RepositoryPathRejected> {
  const attempt = liveness
    .whileConnected(
      client.authorizeRepositoryPath({ nativePath }).pipe(
        Effect.timeout(timeoutMs),
        Effect.catchDefect((detail) =>
          Effect.fail(malformedAgentCommunication(detail, 'Repository path authorization'))
        )
      )
    )
    .pipe(
      Effect.mapError((error) =>
        error instanceof RepositoryPathRejected
          ? error
          : classifyAgentCommunicationFailure(error, 'Repository path authorization')
      ),
      Effect.map((response) => response.canonicalPath)
    )

  return attempt.pipe(
    Effect.retry({
      times: retries,
      while: (error) =>
        error instanceof RepositoryPathRejected
          ? false
          : isRecoverableAgentCommunicationFailure(error)
    }),
    Effect.tapError((error) =>
      error instanceof RepositoryPathRejected || !shouldDisconnectAfterCommunicationFailure(error)
        ? Effect.void
        : liveness.disconnect({ _tag: 'Unreachable', failure: error })
    )
  )
}
