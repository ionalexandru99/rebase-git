import {
  AgentHandshakeRequired,
  AgentProtocolMismatch,
  AgentShuttingDown
} from '@common/features/agent-connection'
import { Cause } from 'effect4'
import { RpcClientError } from 'effect4/unstable/rpc'
import {
  AgentConnectionFailure,
  type AgentConnectionFailureReason
} from './agent-connection-failure'

export function classifyAgentCommunicationFailure(
  error: unknown,
  operation: string,
  malformedReason: AgentConnectionFailureReason = 'ProtocolViolation'
): AgentConnectionFailure {
  if (error instanceof AgentConnectionFailure) {
    return error
  }
  if (error instanceof AgentProtocolMismatch) {
    return new AgentConnectionFailure({
      reason: 'ProtocolMismatch',
      message: `Agent protocol mismatch: expected ${error.expected}, received ${error.received}`,
      detail: error
    })
  }
  if (error instanceof AgentHandshakeRequired) {
    return new AgentConnectionFailure({
      reason: 'ProtocolViolation',
      message: `${operation} was rejected because the Agent session is not open`,
      detail: error
    })
  }
  if (error instanceof AgentShuttingDown) {
    return new AgentConnectionFailure({
      reason: 'AgentStopping',
      message: `${operation} was rejected because the Agent is stopping`,
      detail: error
    })
  }
  if (Cause.isTimeoutError(error)) {
    return new AgentConnectionFailure({
      reason: 'TimedOut',
      message: `${operation} timed out`,
      detail: error
    })
  }
  if (error instanceof RpcClientError.RpcClientError && error.reason._tag === 'RpcClientDefect') {
    return malformedAgentCommunication(error, operation, malformedReason)
  }
  return new AgentConnectionFailure({
    reason: 'TransportFailed',
    message: `${operation} could not reach the Agent`,
    detail: error
  })
}

export function malformedAgentCommunication(
  detail: unknown,
  operation: string,
  reason: AgentConnectionFailureReason = 'ProtocolViolation'
): AgentConnectionFailure {
  return new AgentConnectionFailure({
    reason,
    message: `${operation} received malformed Agent data`,
    detail
  })
}

export function isRecoverableAgentCommunicationFailure(failure: AgentConnectionFailure): boolean {
  return failure.reason === 'TimedOut' || failure.reason === 'TransportFailed'
}

export function shouldDisconnectAfterCommunicationFailure(
  failure: AgentConnectionFailure
): boolean {
  switch (failure.reason) {
    case 'AgentExited':
    case 'AgentStopping':
    case 'ConnectionReleased':
    case 'MonitorFailed':
      return false
    default:
      return true
  }
}
