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
export {
  createEnvironmentRegistry,
  EnvironmentNotRegistered,
  type EnvironmentRegistration,
  type EnvironmentRegistry,
  LOCAL_ENVIRONMENT_ID
} from './features/environment-registry'
export {
  type EnvironmentState,
  type OpenEnvironmentStateOptions,
  openEnvironmentState
} from './features/environment-state'
export {
  type OpenProfileStateOptions,
  openProfileState,
  ProfileStateFailure,
  type ProfileStateStore,
  type ServerProfileState
} from './features/profile-state'

export function startServer(): never {
  throw new Error('Standalone Rebase Server mode has not been implemented yet')
}
