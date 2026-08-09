import type {
  AgentObservation,
  OpenAgentSessionSuccess,
  StopAgentResult
} from '@common/features/agent-connection'
import type { Effect, Stream } from 'effect4'
import type {
  AgentConnectionFailure,
  AgentProcessMonitorError,
  AgentSequenceGap
} from './agent-connection-failure'

export interface AgentProcessExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export type AgentConnectionStatus =
  | { readonly _tag: 'Connected' }
  | { readonly _tag: 'StopRequested' }
  | { readonly _tag: 'Exited'; readonly exit: AgentProcessExit }
  | { readonly _tag: 'MonitoringFailed'; readonly error: AgentProcessMonitorError }
  | { readonly _tag: 'Unreachable'; readonly failure: AgentConnectionFailure }
  | { readonly _tag: 'Released' }

export type AgentCommandOutcome =
  | StopAgentResult
  | {
      readonly _tag: 'RejectedByAgent'
      readonly operationId: string
      readonly reason: 'AgentHandshakeRequired' | 'AgentShuttingDown'
      readonly requiresRefresh: false
    }
  | {
      readonly _tag: 'NotDispatched'
      readonly operationId: string
      readonly reason: 'ConnectionUnavailable' | 'InvalidOperationId'
      readonly requiresRefresh: false
    }
  | {
      readonly _tag: 'OutcomeUnknown'
      readonly operationId: string
      readonly requiresRefresh: true
    }

export interface ConnectAgentOptions {
  readonly agentExited: Effect.Effect<AgentProcessExit, AgentProcessMonitorError>
  readonly requestTimeoutMs?: number
  readonly safeQueryRetries?: number
  readonly streamReconnects?: number
  readonly streamReconnectDelayMs?: number
}

export interface AgentConnection {
  readonly compatibility: OpenAgentSessionSuccess
  readonly status: Effect.Effect<AgentConnectionStatus>
  readonly ping: (requestId: string) => Effect.Effect<number, AgentConnectionFailure>
  readonly agentActivity: Stream.Stream<AgentObservation, AgentConnectionFailure | AgentSequenceGap>
  readonly shutdown: (operationId: string) => Effect.Effect<AgentCommandOutcome>
}
