import { randomBytes } from 'node:crypto'
import os from 'node:os'
import { AGENT_PROTOCOL, type AgentReadyRecord } from '@common/features/agent-connection'
import { Deferred, Effect } from 'effect4'
import { AGENT_PRODUCT_VERSION, type AgentConfiguration } from './configuration'
import { makeAgentConversationLayer } from './conversations/agent-conversation-layer'
import { makeAgentLogger } from './logging/redacted-agent-logger'
import { makeAgentSession } from './session/agent-session'
import { makeAgentHttpHandler } from './transport/agent-http-handler'
import { type AgentLoopbackBindFailure, serveLoopback } from './transport/loopback-server'

function awaitProcessSignal(): Effect.Effect<NodeJS.Signals> {
  return Effect.callback<NodeJS.Signals>((resume) => {
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

export function agentProgram(
  configuration: AgentConfiguration
): Effect.Effect<void, AgentLoopbackBindFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      const logger = yield* makeAgentLogger(configuration.maxLogEntryBytes)
      const bootstrapSecret = randomBytes(32).toString('base64url')
      yield* logger.registerSecret(bootstrapSecret)
      const session = yield* makeAgentSession(
        bootstrapSecret,
        configuration.streamBufferEvents,
        logger
      )
      yield* Effect.addFinalizer(() =>
        session.completeShutdown.pipe(Effect.andThen(logger.write('agent-stopped')))
      )
      const shutdownRequested = yield* Deferred.make<void>()
      const handlersLayer = makeAgentConversationLayer(
        session,
        configuration,
        shutdownRequested,
        logger
      )
      const httpHandler = yield* makeAgentHttpHandler(session, logger, configuration, handlersLayer)
      const port = yield* serveLoopback(
        httpHandler,
        configuration.port,
        configuration.shutdownGraceMs,
        logger
      )

      const requestShutdown = (event: string, fields?: Readonly<Record<string, unknown>>) =>
        session.beginShutdown.pipe(
          Effect.andThen(logger.write(event, fields)),
          Effect.andThen(Deferred.succeed(shutdownRequested, undefined)),
          Effect.asVoid
        )
      yield* awaitProcessSignal().pipe(
        Effect.flatMap((signal) => requestShutdown('agent-signal-received', { signal })),
        Effect.forkScoped
      )
      yield* Effect.yieldNow
      const orphanCheckInterval = Math.max(
        25,
        Math.min(1_000, Math.floor(configuration.orphanTimeoutMs / 4))
      )
      yield* Effect.forever(
        Effect.sleep(orphanCheckInterval).pipe(
          Effect.andThen(session.inactiveFor),
          Effect.flatMap((inactiveMs) =>
            inactiveMs >= configuration.orphanTimeoutMs
              ? requestShutdown('agent-orphan-timeout')
              : Effect.void
          )
        )
      ).pipe(Effect.forkScoped)
      yield* Effect.forever(
        Effect.sleep(configuration.heartbeatIntervalMs).pipe(
          Effect.andThen(session.publishHeartbeat)
        )
      ).pipe(Effect.forkScoped)

      const ready: AgentReadyRecord = {
        type: 'ready',
        port,
        bootstrapSecret,
        productVersion: AGENT_PRODUCT_VERSION,
        agentProtocol: AGENT_PROTOCOL,
        platform: os.platform(),
        architecture: os.arch()
      }
      yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(ready)}\n`))
      yield* Deferred.await(shutdownRequested)
    })
  )
}
