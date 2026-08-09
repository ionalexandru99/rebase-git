import { AgentRpcs, RepositoryPathRejected } from '@common/features/agent-connection'
import { type Deferred, Effect } from 'effect4'
import type { RepositoryAccess } from '../../repository-access'
import type { AgentConfiguration } from '../configuration'
import type { AgentLogger } from '../logging/redacted-agent-logger'
import type { AgentSession } from '../session/agent-session'
import { coordinateAgentShutdown } from './coordinate-agent-shutdown'
import { negotiateAgentSession } from './negotiate-agent-session'

export function makeAgentConversationLayer(
  session: AgentSession,
  configuration: AgentConfiguration,
  shutdownRequested: Deferred.Deferred<void>,
  logger: AgentLogger,
  repositoryAccess: RepositoryAccess
) {
  return AgentRpcs.toLayer({
    openAgentSession: ({ agentProtocol }) =>
      negotiateAgentSession(session, configuration, logger, agentProtocol),
    pingAgent: ({ requestId }) =>
      session.currentSequence.pipe(Effect.map((sequence) => ({ requestId, sequence }))),
    observeAgent: ({ afterSequence }) => session.observations(afterSequence),
    authorizeRepositoryPath: ({ nativePath }) =>
      session.requireRunning.pipe(
        Effect.andThen(repositoryAccess.authorizeDirectory(nativePath)),
        Effect.map((canonicalPath) => ({ canonicalPath })),
        Effect.mapError((error) =>
          error._tag === 'RepositoryAccessFailure'
            ? new RepositoryPathRejected({ reason: error.reason })
            : error
        )
      ),
    stopAgent: ({ operationId, expectedState }) =>
      coordinateAgentShutdown(session, shutdownRequested, operationId, expectedState)
  })
}
