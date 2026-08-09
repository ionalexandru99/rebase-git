import { AgentHandshakeRequired } from '../../src/common/features/agent-connection'
import { Effect } from 'effect4'
import { describe, expect, it } from 'vitest'
import { connectAgent } from '../../src/server/features/agent-connection'
import { dispatchAgentShutdown } from '../../src/server/features/agent-connection/dispatch-agent-shutdown'
import { acquireAgentProcess } from './server-process-harness'

describe('Server Agent command certainty', () => {
  it('rejects an invalid operation id before dispatch', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess()
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          })
          const invalidOperationIds = ['', 'x'.repeat(129)]
          const outcomes = yield* Effect.all(
            invalidOperationIds.map((operationId) => connection.shutdown(operationId))
          )
          return {
            invalidOperationIds,
            outcomes,
            stopAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('stopAgent')
            ).length
          }
        })
      )
    )

    expect(result.outcomes).toEqual(
      result.invalidOperationIds.map((operationId) => ({
        _tag: 'NotDispatched',
        operationId,
        reason: 'InvalidOperationId',
        requiresRefresh: false
      }))
    )
    expect(result.stopAttempts).toBe(0)
  })

  it('preserves a typed Agent rejection as a definitive command outcome', async () => {
    const outcome = await Effect.runPromise(
      dispatchAgentShutdown(
        {
          stopAgent: () => Effect.fail(new AgentHandshakeRequired())
        } as never,
        {
          status: Effect.succeed({ _tag: 'Connected' }),
          whileConnected: (effect: Effect.Effect<unknown, unknown>) => effect,
          disconnect: () => Effect.void
        } as never,
        'typed-agent-rejection',
        2_000
      )
    )

    expect(outcome).toEqual({
      _tag: 'RejectedByAgent',
      operationId: 'typed-agent-rejection',
      reason: 'AgentHandshakeRequired',
      requiresRefresh: false
    })
  })

  it('returns OutcomeUnknown when the Agent never answers a shutdown command', async () => {
    const outcome = await Effect.runPromise(
      dispatchAgentShutdown(
        {
          stopAgent: () => Effect.never
        } as never,
        {
          status: Effect.succeed({ _tag: 'Connected' }),
          whileConnected: (effect: Effect.Effect<unknown, unknown>) => effect,
          disconnect: () => Effect.void
        } as never,
        'pending-shutdown',
        20
      )
    )

    expect(outcome).toEqual({
      _tag: 'OutcomeUnknown',
      operationId: 'pending-shutdown',
      requiresRefresh: true
    })
  })

  it('reports NotDispatched only when liveness is unavailable before invocation', async () => {
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
          const outcome = yield* connection.shutdown('known-before-dispatch')
          return {
            outcome,
            stopAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('stopAgent')
            ).length
          }
        })
      )
    )

    expect(result.outcome).toEqual({
      _tag: 'NotDispatched',
      operationId: 'known-before-dispatch',
      reason: 'ConnectionUnavailable',
      requiresRefresh: false
    })
    expect(result.stopAttempts).toBe(0)
  })

  it('reports OutcomeUnknown when transport breaks during the write to the Agent', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) =>
            exchange.tags.includes('stopAgent') ? 'drop-during-agent-write' : 'forward'
          )
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          })
          const outcome = yield* connection.shutdown('lost-before-agent')
          return {
            outcome,
            stopAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('stopAgent')
            ),
            fullBodyBytes: Buffer.byteLength(
              process.proxy.exchanges.find((exchange) => exchange.tags.includes('stopAgent'))?.body ??
                ''
            )
          }
        })
      )
    )

    expect(result.outcome).toEqual({
      _tag: 'OutcomeUnknown',
      operationId: 'lost-before-agent',
      requiresRefresh: true
    })
    expect(result.stopAttempts).toHaveLength(1)
    expect(result.stopAttempts[0]?.upstreamBodyBytes).toBeGreaterThan(0)
    expect(result.stopAttempts[0]?.upstreamBodyBytes).toBeLessThan(result.fullBodyBytes)
  })

  it('reports OutcomeUnknown after Agent mutation when the response is lost', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) =>
            exchange.tags.includes('stopAgent') ? 'drop-after-agent-response' : 'forward'
          )
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          })
          const outcome = yield* connection.shutdown('lost-after-mutation')
          yield* process.agentExited
          return {
            outcome,
            stopAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('stopAgent')
            ).length
          }
        })
      )
    )

    expect(result.outcome).toEqual({
      _tag: 'OutcomeUnknown',
      operationId: 'lost-after-mutation',
      requiresRefresh: true
    })
    expect(result.stopAttempts).toBe(1)
  })
})
