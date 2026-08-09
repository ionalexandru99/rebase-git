import { realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import { Data, Effect } from 'effect4'
import { createFakeEnvironmentConnection, startBrowserServer } from '../browser-server'
import { makeServerDiagnostics } from '../browser-server/diagnostics'
import { type BrowserOpeningOutcome, openBrowser } from './browser-opening/browser-opener'
import type { ServerInvocationOptions } from './server-invocation-options'

export class ServerInvocationFailure extends Data.TaggedError('ServerInvocationFailure')<{
  readonly message: string
  readonly detail?: unknown
}> {}

function awaitProcessSignal(): Effect.Effect<NodeJS.Signals> {
  return Effect.callback((resume) => {
    const detach = () => {
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
    }
    const onInterrupt = () => {
      detach()
      resume(Effect.succeed('SIGINT'))
    }
    const onTerminate = () => {
      detach()
      resume(Effect.succeed('SIGTERM'))
    }
    process.once('SIGINT', onInterrupt)
    process.once('SIGTERM', onTerminate)
    return Effect.sync(detach)
  })
}

function writeOutput(line: string): Effect.Effect<void> {
  return Effect.sync(() => process.stdout.write(`${line}\n`))
}

function writeBrowserOutcome(outcome: BrowserOpeningOutcome): Effect.Effect<void> {
  if (outcome._tag === 'Opened') {
    return Effect.void
  }
  return Effect.forEach(outcome.instructions, writeOutput, { discard: true })
}

export function serverProgram(
  options: ServerInvocationOptions,
  webRoot: string
): Effect.Effect<
  void,
  | ServerInvocationFailure
  | import('../browser-server').BrowserServerFailure
  | import('../browser-server').RendererBuildFailure
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const initialPath = yield* Effect.tryPromise({
        try: async () => {
          const canonicalPath = await realpath(options.path)
          const pathStats = await stat(canonicalPath)
          if (!pathStats.isDirectory()) {
            throw new TypeError('The selected repository or workspace path is not a directory')
          }
          return canonicalPath
        },
        catch: (detail) =>
          new ServerInvocationFailure({
            message: `Could not access repository or workspace path: ${options.path}`,
            detail
          })
      })
      const diagnostics = yield* makeServerDiagnostics({
        maxEntryBytes: 4_096,
        maxRecentEntries: 100,
        writeLine: (line) => process.stderr.write(line)
      })
      const server = yield* startBrowserServer({
        environmentConnection: createFakeEnvironmentConnection({
          initialPath,
          readOnly: options.readOnly
        }),
        port: options.port,
        webRoot
      })
      const browserTicket = new URL(server.browserUrl).pathname.split('/').at(-1)
      if (browserTicket) {
        yield* diagnostics.registerSecret(browserTicket)
      }
      yield* diagnostics.record('server-ready', {
        port: server.port,
        readOnly: options.readOnly,
        rendererBuildId: server.rendererBuildId,
        serverInstanceId: server.serverInstanceId
      })
      yield* Effect.addFinalizer(() => diagnostics.record('server-stopped'))
      yield* writeOutput('Rebase Server is ready')
      yield* writeOutput(
        `Local Environment: ${initialPath}${options.readOnly ? ' (read-only)' : ''}`
      )
      if (options.open === 'none') {
        yield* writeOutput(`Open ${server.browserUrl}`)
      } else {
        yield* writeOutput(`Opening ${server.browserUrl}`)
        const browserOpening = yield* openBrowser(
          {
            browserUrl: server.browserUrl,
            readinessUrl: `${server.origin}/.well-known/rebase/health`
          },
          {
            environment: {
              platform: process.platform,
              release: os.release(),
              variables: process.env
            }
          }
        )
        if (browserOpening._tag === 'Instructions') {
          yield* diagnostics.record('browser-open-instructions', {
            reason: browserOpening.reason
          })
        }
        yield* writeBrowserOutcome(browserOpening)
      }
      yield* writeOutput('Press Ctrl+C to stop')
      const signal = yield* awaitProcessSignal()
      yield* diagnostics.record('server-signal-received', { signal })
    })
  )
}
