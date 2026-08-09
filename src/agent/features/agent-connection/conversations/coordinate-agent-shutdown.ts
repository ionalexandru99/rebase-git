import type { StopAgentExpectedState } from '@common/features/agent-connection'
import { Deferred, Effect } from 'effect4'
import type { AgentSession } from '../session/agent-session'

export function coordinateAgentShutdown(
  session: AgentSession,
  shutdownRequested: Deferred.Deferred<void>,
  operationId: string,
  expectedState: StopAgentExpectedState
) {
  return session.requestStop(operationId, expectedState).pipe(
    Effect.tap((decision) =>
      decision.shouldShutdown ? Deferred.succeed(shutdownRequested, undefined) : Effect.void
    ),
    Effect.map((decision) => decision.result)
  )
}
