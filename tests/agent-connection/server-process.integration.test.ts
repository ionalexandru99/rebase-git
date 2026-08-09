import { Effect, Fiber, Option, Stream } from 'effect4'
import { describe, expect, it } from 'vitest'
import { connectAgent } from '../../src/server/features/agent-connection'
import { acquireAgentProcess } from './server-process-harness'

describe('Server Agent connection process ownership', () => {
  it('owns one scoped session through health, observation, and shutdown', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess()
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000,
            streamReconnectDelayMs: 5
          })
          const sequence = yield* connection.ping('server-integration-ping')
          const observation = yield* connection.agentActivity.pipe(
            Stream.runHead,
            Effect.timeout(2_000)
          )
          const shutdown = yield* connection.shutdown('server-integration-shutdown')
          const repeatedShutdown = yield* connection.shutdown('server-integration-repeated')
          const exit = yield* process.agentExited
          return {
            sequence,
            observation: Option.getOrThrow(observation),
            shutdown,
            repeatedShutdown,
            exit,
            stdoutAfterAnnouncement: process.stdoutAfterAnnouncement()
          }
        })
      )
    )

    expect(result.sequence).toBeGreaterThan(0)
    expect(result.observation.sequence).toBeGreaterThan(0)
    expect(result.shutdown._tag).toBe('Applied')
    expect(result.repeatedShutdown).toEqual({
      _tag: 'NotDispatched',
      operationId: 'server-integration-repeated',
      reason: 'ConnectionUnavailable',
      requiresRefresh: false
    })
    expect(result.exit.code).toBe(0)
    expect(result.stdoutAfterAnnouncement).toBe('')
  })

  it('detects an involuntary Agent exit and stops dispatching commands', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess()
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          })
          yield* Effect.sync(() => process.child.kill('SIGKILL'))
          yield* process.agentExited
          yield* Effect.sleep(10)
          const status = yield* connection.status
          const shutdown = yield* connection.shutdown('server-after-crash')
          return {
            status,
            shutdown,
            stopAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('stopAgent')
            ).length
          }
        })
      )
    )

    expect(result.status._tag).toBe('Exited')
    expect(result.shutdown).toEqual({
      _tag: 'NotDispatched',
      operationId: 'server-after-crash',
      reason: 'ConnectionUnavailable',
      requiresRefresh: false
    })
    expect(result.stopAttempts).toBe(0)
  })

  it('rejects a malformed session handshake', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) =>
            exchange.tags.includes('openAgentSession') ? 'malform-agent-response' : 'forward'
          )
          const failure = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          }).pipe(Effect.flip)
          return {
            failure,
            openAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('openAgentSession')
            ).length
          }
        })
      )
    )

    expect(result.failure.reason).toBe('MalformedHandshake')
    expect(result.openAttempts).toBe(1)
  })

  it('cancels repository observation without invalidating the session', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess()
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          })
          const observation = yield* connection.agentActivity.pipe(
            Stream.runDrain,
            Effect.forkChild
          )
          yield* Effect.sleep(30)
          yield* Fiber.interrupt(observation)
          const sequence = yield* connection.ping('after-observation-cancellation')
          const shutdown = yield* connection.shutdown('after-observation-cancellation')
          return { sequence, shutdown }
        })
      )
    )

    expect(result.sequence).toBeGreaterThan(0)
    expect(result.shutdown._tag).toBe('Applied')
  })
})
