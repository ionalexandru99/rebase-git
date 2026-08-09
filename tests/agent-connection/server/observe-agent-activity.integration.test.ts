import { Effect, Option, Stream } from 'effect4'
import { describe, expect, it } from 'vitest'
import {
  AgentSequenceGap,
  connectAgent
} from '../../../src/server/features/agent-connection'
import { acquireAgentProcess } from './agent-process-harness'

describe('Server Agent safe recovery', () => {
  it('retries session negotiation after one transport break', async () => {
    let openAttempts = 0
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) => {
            if (exchange.tags.includes('openAgentSession')) {
              openAttempts += 1
              return openAttempts === 1 ? 'drop-before-agent' : 'forward'
            }
            return 'forward'
          })
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000
          })
          const sequence = yield* connection.ping('session-recovery-ping')
          return {
            sequence,
            openAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('openAgentSession')
            ).length
          }
        })
      )
    )

    expect(result.sequence).toBeGreaterThan(0)
    expect(result.openAttempts).toBe(2)
  })

  it('retries a safe health query after one transport break', async () => {
    let pingAttempts = 0
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) => {
            if (exchange.tags.includes('pingAgent')) {
              pingAttempts += 1
              return pingAttempts === 1 ? 'drop-before-agent' : 'forward'
            }
            return 'forward'
          })
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000,
            safeQueryRetries: 1
          })
          const sequence = yield* connection.ping('safe-query-retry')
          return {
            sequence,
            pingAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('pingAgent')
            ).length
          }
        })
      )
    )

    expect(result.sequence).toBeGreaterThan(0)
    expect(result.pingAttempts).toBe(2)
  })

  it('reconnects repository observation after an involuntary stream break', async () => {
    let streamAttempts = 0
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) => {
            if (exchange.tags.includes('observeAgent')) {
              streamAttempts += 1
              return streamAttempts === 1 ? 'drop-before-agent' : 'forward'
            }
            return 'forward'
          })
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000,
            streamReconnects: 1,
            streamReconnectDelayMs: 5
          })
          const observation = yield* connection.agentActivity.pipe(
            Stream.runHead,
            Effect.timeout(2_000)
          )
          return {
            observation: Option.getOrThrow(observation),
            streamAttempts: process.proxy.exchanges.filter((exchange) =>
              exchange.tags.includes('observeAgent')
            ).length
          }
        })
      )
    )

    expect(result.observation.sequence).toBeGreaterThan(0)
    expect(result.streamAttempts).toBe(2)
  })

  it('terminates observation with a refresh requirement on a sequence gap', async () => {
    const failure = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* acquireAgentProcess((exchange) =>
            exchange.tags.includes('observeAgent') ? 'gap-second-observation' : 'forward'
          )
          const connection = yield* connectAgent(process.ready, {
            agentExited: process.agentExited,
            requestTimeoutMs: 2_000,
            streamReconnects: 3,
            streamReconnectDelayMs: 5
          })
          return yield* connection.agentActivity.pipe(
            Stream.runDrain,
            Effect.flip,
            Effect.timeout(2_000)
          )
        })
      )
    )

    expect(failure).toBeInstanceOf(AgentSequenceGap)
    if (failure instanceof AgentSequenceGap) {
      expect(failure.received).toBeGreaterThan(failure.expected)
      expect(failure.requiresRefresh).toBe(true)
    }
  })
})
