import { Effect } from 'effect4'
import {
  type BrowserServerFailure,
  createFakeEnvironmentConnection,
  makeServerDiagnostics,
  type RendererBuildFailure,
  type ServerDiagnostics,
  startBrowserServer
} from '../browser-server'
import { type BrowserOpeningOutcome, openBrowser } from './browser-opening/browser-opener'
import {
  parseServerInvocationOptions,
  type ServerInvocationOptions,
  type ServerInvocationOptionsFailure
} from './server-invocation-options'

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
  webRoot: string,
  diagnostics: ServerDiagnostics
): Effect.Effect<void, BrowserServerFailure | RendererBuildFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* startBrowserServer({
        environmentConnection: createFakeEnvironmentConnection({
          initialPath: options.path,
          readOnly: options.readOnly
        }),
        port: options.port,
        webRoot
      })
      yield* diagnostics.registerSecret(server.browserTicket)
      yield* diagnostics.record('server-ready', {
        port: server.port,
        readOnly: options.readOnly,
        rendererBuildId: server.rendererBuildId,
        serverInstanceId: server.serverInstanceId
      })
      yield* Effect.addFinalizer(() => diagnostics.record('server-stopped'))
      yield* writeOutput('Rebase Server is ready')
      yield* writeOutput(
        `Local Environment: ${options.path}${options.readOnly ? ' (read-only)' : ''}`
      )
      if (options.open === 'none') {
        yield* writeOutput(`Open ${server.browserUrl}`)
      } else {
        yield* writeOutput(`Opening ${server.browserUrl}`)
        const browserOpening = yield* openBrowser({
          browserUrl: server.browserUrl,
          readinessUrl: `${server.origin}/.well-known/rebase/health`
        })
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

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function standaloneServerProgram(
  arguments_: readonly string[],
  currentDirectory: string,
  webRoot: string
): Effect.Effect<
  void,
  BrowserServerFailure | RendererBuildFailure | ServerInvocationOptionsFailure
> {
  return makeServerDiagnostics({
    maxEntryBytes: 4_096,
    maxRecentEntries: 100,
    writeLine: (line) => process.stderr.write(line)
  }).pipe(
    Effect.flatMap((diagnostics) => {
      const parsedOptions = parseServerInvocationOptions(arguments_, currentDirectory)
      const program: Effect.Effect<
        void,
        BrowserServerFailure | RendererBuildFailure | ServerInvocationOptionsFailure
      > =
        parsedOptions._tag === 'Success'
          ? serverProgram(parsedOptions.options, webRoot, diagnostics)
          : Effect.fail(parsedOptions.failure)
      return program.pipe(
        Effect.tapError((error) =>
          diagnostics.record('server-start-failed', { error: failureMessage(error) })
        )
      )
    })
  )
}
