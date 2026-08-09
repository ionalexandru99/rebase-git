import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Effect } from 'effect4'
import { agentProgram, parseAgentConfiguration } from './features/agent-connection'
import type { AgentConfigurationFailure } from './features/agent-connection/configuration'
import type { AgentLoopbackBindFailure } from './features/agent-connection/transport/loopback-server'

function isDirectInvocation(entryPath: string): boolean {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPath)
  } catch {
    return import.meta.url === pathToFileURL(entryPath).href
  }
}

if (process.argv[1] && isDirectInvocation(process.argv[1])) {
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
