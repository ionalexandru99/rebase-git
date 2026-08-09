export type {
  AgentCommandOutcome,
  AgentConnection,
  AgentConnectionStatus,
  AgentProcessExit,
  ConnectAgentOptions
} from './agent-connection'
export { connectAgent } from './connect-agent'
export {
  AgentConnectionFailure,
  type AgentConnectionFailureReason,
  AgentProcessMonitorError,
  AgentSequenceGap
} from './failure/agent-connection-failure'
export { readAgentAnnouncement } from './lifecycle/read-agent-announcement'
