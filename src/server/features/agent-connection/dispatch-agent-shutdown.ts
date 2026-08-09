import {
  AGENT_PROTOCOL,
  AgentHandshakeRequired,
  AgentOperationIdSchema,
  AgentShuttingDown
} from '@common/features/agent-connection'
import { Cause, Effect, Schema } from 'effect4'
import { RpcClientError } from 'effect4/unstable/rpc'
import type { AgentCommandOutcome } from './agent-connection'
import { AgentConnectionFailure } from './failure/agent-connection-failure'
import type { AgentLiveness } from './lifecycle/agent-liveness'
import type { AgentInterfaceClient } from './session/establish-agent-session'

function isValidOperationId(operationId: string): boolean {
  return Schema.is(AgentOperationIdSchema)(operationId)
}

function rejectedByAgent(
  operationId: string,
  reason: 'AgentHandshakeRequired' | 'AgentShuttingDown'
): AgentCommandOutcome {
  return {
    _tag: 'RejectedByAgent',
    operationId,
    reason,
    requiresRefresh: false
  }
}

function uncertainShutdownFailure(error: unknown): AgentConnectionFailure {
  if (error instanceof AgentConnectionFailure) {
    return error
  }
  if (Cause.isTimeoutError(error)) {
    return new AgentConnectionFailure({
      reason: 'TimedOut',
      message: 'Agent shutdown command timed out after dispatch may have begun',
      detail: error
    })
  }
  if (error instanceof RpcClientError.RpcClientError && error.reason._tag === 'RpcClientDefect') {
    return new AgentConnectionFailure({
      reason: 'ProtocolViolation',
      message: 'Agent shutdown command returned malformed protocol data',
      detail: error
    })
  }
  return new AgentConnectionFailure({
    reason: 'TransportFailed',
    message: 'Agent shutdown command failed after dispatch may have begun',
    detail: error
  })
}

export function dispatchAgentShutdown(
  client: AgentInterfaceClient,
  liveness: AgentLiveness,
  operationId: string,
  timeoutMs: number
): Effect.Effect<AgentCommandOutcome> {
  if (!isValidOperationId(operationId)) {
    return Effect.succeed({
      _tag: 'NotDispatched',
      operationId,
      reason: 'InvalidOperationId',
      requiresRefresh: false
    })
  }

  return Effect.uninterruptibleMask((restore) =>
    liveness.status.pipe(
      Effect.flatMap((status) => {
        if (status._tag !== 'Connected') {
          return Effect.succeed<AgentCommandOutcome>({
            _tag: 'NotDispatched',
            operationId,
            reason: 'ConnectionUnavailable',
            requiresRefresh: false
          })
        }

        return restore(
          liveness.whileConnected(
            client
              .stopAgent({
                operationId,
                expectedState: { agentProtocol: AGENT_PROTOCOL, lifecycle: 'running' }
              })
              .pipe(
                Effect.timeout(timeoutMs),
                Effect.catchDefect((detail) =>
                  Effect.fail(
                    new AgentConnectionFailure({
                      reason: 'ProtocolViolation',
                      message: 'Agent shutdown command failed with malformed protocol data',
                      detail
                    })
                  )
                )
              )
          )
        ).pipe(
          Effect.tap((result) =>
            result._tag === 'Applied' ? liveness.disconnect({ _tag: 'StopRequested' }) : Effect.void
          ),
          Effect.catch((error) => {
            if (error instanceof AgentHandshakeRequired) {
              const failure = new AgentConnectionFailure({
                reason: 'ProtocolViolation',
                message: 'Agent rejected shutdown because its session is not open',
                detail: error
              })
              return liveness
                .disconnect({ _tag: 'Unreachable', failure })
                .pipe(Effect.as(rejectedByAgent(operationId, 'AgentHandshakeRequired')))
            }
            if (error instanceof AgentShuttingDown) {
              return liveness
                .disconnect({ _tag: 'StopRequested' })
                .pipe(Effect.as(rejectedByAgent(operationId, 'AgentShuttingDown')))
            }
            const failure = uncertainShutdownFailure(error)
            return liveness.disconnect({ _tag: 'Unreachable', failure }).pipe(
              Effect.as<AgentCommandOutcome>({
                _tag: 'OutcomeUnknown',
                operationId,
                requiresRefresh: true
              })
            )
          })
        )
      })
    )
  )
}
