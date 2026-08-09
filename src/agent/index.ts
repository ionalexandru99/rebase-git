import { pathToFileURL } from 'node:url'
import { Effect } from 'effect4'
import { agentProgram, parseAgentConfiguration } from './features/agent-connection'
import type { AgentConfigurationFailure } from './features/agent-connection/configuration'
import type { AgentLoopbackBindFailure } from './features/agent-connection/transport/loopback-server'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsedConfiguration = parseAgentConfiguration(process.argv.slice(2))
  const standaloneProgram: Effect.Effect<
    void,
    AgentConfigurationFailure | AgentLoopbackBindFailure
  > =
    parsedConfiguration._tag === 'Success'
      ? agentProgram(parsedConfiguration.configuration)
      : Effect.fail(parsedConfiguration.failure)
  Effect.runPromise(standaloneProgram).catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        event: 'agent-start-failed',
        error: error instanceof Error ? error.message : String(error)
      })}\n`
    )
    process.exitCode = 1
  })
}
