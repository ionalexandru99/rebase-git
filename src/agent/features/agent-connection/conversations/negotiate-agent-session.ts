import os from 'node:os'
import { AGENT_PROTOCOL, type OpenAgentSessionSuccess } from '@common/features/agent-connection'
import { Effect } from 'effect4'
import { AGENT_PRODUCT_VERSION, type AgentConfiguration } from '../configuration'
import { discoverGit } from '../git/discover-git'
import type { AgentLogger } from '../logging/redacted-agent-logger'
import type { AgentSession } from '../session/agent-session'

export function negotiateAgentSession(
  session: AgentSession,
  configuration: AgentConfiguration,
  logger: AgentLogger,
  agentProtocol: number
) {
  return Effect.gen(function* () {
    yield* logger.write('agent-session-opening', { agentProtocol })
    const git = yield* discoverGit(configuration.gitTerminationGraceMs)
    yield* session.open(agentProtocol)
    yield* logger.write('agent-session-opened', { agentProtocol })
    return {
      productVersion: AGENT_PRODUCT_VERSION,
      agentProtocol: AGENT_PROTOCOL,
      platform: os.platform(),
      architecture: os.arch(),
      git,
      limits: {
        maxRequestBytes: configuration.maxRequestBytes,
        streamBufferEvents: configuration.streamBufferEvents,
        orphanTimeoutMs: configuration.orphanTimeoutMs
      }
    } satisfies OpenAgentSessionSuccess
  })
}
