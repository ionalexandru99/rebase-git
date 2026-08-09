export {
  type AgentCommandOutcome,
  type AgentConnection,
  AgentConnectionFailure,
  type AgentConnectionFailureReason,
  type AgentConnectionStatus,
  type AgentProcessExit,
  AgentProcessMonitorError,
  AgentSequenceGap,
  type ConnectAgentOptions,
  connectAgent,
  readAgentAnnouncement
} from './features/agent-connection'

export function startServer(): never {
  throw new Error('Standalone Rebase Server mode has not been implemented yet')
}
