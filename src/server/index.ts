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
  BrowserServerFailure,
  createFakeEnvironmentConnection,
  RendererBuildFailure,
  type RunningBrowserServer,
  type StartBrowserServerOptions,
  startBrowserServer
} from './features/browser-server'
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
export {
  parseServerInvocationOptions,
  type ServerInvocationOptions,
  ServerInvocationOptionsFailure,
  serverProgram,
  standaloneServerProgram
} from './features/server-invocation'

import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Effect } from 'effect4'
import { standaloneServerProgram } from './features/server-invocation'

function isDirectInvocation(entryPath: string): boolean {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPath)
  } catch {
    return import.meta.url === pathToFileURL(entryPath).href
  }
}

if (process.argv[1] && isDirectInvocation(process.argv[1])) {
  const standaloneProgram = standaloneServerProgram(
    process.argv.slice(2),
    process.cwd(),
    fileURLToPath(new URL('../web/', import.meta.url))
  )
  Effect.runPromise(standaloneProgram).catch(() => {
    process.exitCode = 1
  })
}
