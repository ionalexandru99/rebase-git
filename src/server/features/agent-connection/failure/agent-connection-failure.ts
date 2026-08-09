import { Data } from 'effect4'

export type AgentConnectionFailureReason =
  | 'AgentExited'
  | 'AgentStopping'
  | 'BootstrapOutcomeUnknown'
  | 'BootstrapRejected'
  | 'ConnectionReleased'
  | 'MalformedBootstrap'
  | 'MalformedHandshake'
  | 'MalformedReadiness'
  | 'MonitorFailed'
  | 'ProtocolMismatch'
  | 'ProtocolViolation'
  | 'ReadinessTooLarge'
  | 'TimedOut'
  | 'TransportFailed'
  | 'UnexpectedStdout'

export class AgentConnectionFailure extends Data.TaggedError('AgentConnectionFailure')<{
  readonly reason: AgentConnectionFailureReason
  readonly message: string
  readonly detail?: unknown
}> {}

export class AgentProcessMonitorError extends Data.TaggedError('AgentProcessMonitorError')<{
  readonly message: string
  readonly detail?: unknown
}> {}

export class AgentSequenceGap extends Data.TaggedError('AgentSequenceGap')<{
  readonly expected: number
  readonly received: number
  readonly requiresRefresh: true
}> {}
