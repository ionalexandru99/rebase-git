import { AGENT_PROTOCOL } from '../../src/common/features/agent-connection'
import { Deferred, Effect, Fiber, Ref, Stream } from 'effect4'
import { describe, expect, it } from 'vitest'
import { makeAgentLogger } from '../../src/agent/features/agent-connection/logging/redacted-agent-logger'
import { makeAgentSession } from '../../src/agent/features/agent-connection/session/agent-session'

describe('Agent observation session', () => {
  it('keeps monotonic sequence and exposes a jump when a slow subscriber exceeds the bounded buffer', async () => {
    const observations = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const logger = yield* makeAgentLogger(8_192)
          const session = yield* makeAgentSession('b'.repeat(43), 2, logger)
          yield* session.claim('b'.repeat(43))
          yield* session.open(AGENT_PROTOCOL)

          const firstDelivered = yield* Deferred.make<void>()
          const releaseSubscriber = yield* Deferred.make<void>()
          const overflowDelivered = yield* Deferred.make<void>()
          const delivered = yield* Ref.make<ReadonlyArray<number>>([])
          const subscriber = yield* session.observations(undefined).pipe(
            Stream.runForEach((observation) =>
              Effect.gen(function* () {
                const sequences = yield* Ref.updateAndGet(delivered, (current) => [
                  ...current,
                  observation.sequence
                ])
                if (sequences.length === 1) {
                  yield* Deferred.succeed(firstDelivered, undefined)
                  yield* Deferred.await(releaseSubscriber)
                }
                if (sequences.length === 3) {
                  yield* Deferred.succeed(overflowDelivered, undefined)
                }
              })
            ),
            Effect.forkScoped
          )

          yield* Deferred.await(firstDelivered)
          for (let index = 2; index <= 6; index += 1) {
            yield* session.publishRepositoryChanged({
              _tag: 'RepositoryChanged',
              nativePath: `/repository/${index}`,
              aspects: ['workingCopy']
            })
          }
          yield* Deferred.succeed(releaseSubscriber, undefined)
          yield* Deferred.await(overflowDelivered).pipe(Effect.timeout(2_000))
          yield* Fiber.interrupt(subscriber)

          const replay = yield* session.observations(5).pipe(Stream.take(1), Stream.runCollect)
          return {
            delivered: yield* Ref.get(delivered),
            replay: Array.from(replay)
          }
        })
      )
    )

    expect(observations.delivered).toEqual([1, 5, 6])
    expect(observations.replay).toEqual([
      {
        _tag: 'RepositoryChanged',
        sequence: 6,
        nativePath: '/repository/6',
        aspects: ['workingCopy']
      }
    ])
  })

  it('applies one stop operation idempotently and rejects a competing operation', async () => {
    const decisions = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const logger = yield* makeAgentLogger(8_192)
          const session = yield* makeAgentSession('s'.repeat(43), 2, logger)
          yield* session.claim('s'.repeat(43))
          yield* session.open(AGENT_PROTOCOL)
          const expectedState = { agentProtocol: AGENT_PROTOCOL, lifecycle: 'running' as const }
          return {
            first: yield* session.requestStop('stop-once', expectedState),
            repeated: yield* session.requestStop('stop-once', expectedState),
            competing: yield* session.requestStop('stop-twice', expectedState)
          }
        })
      )
    )

    expect(decisions.first).toEqual({
      result: { _tag: 'Applied', operationId: 'stop-once' },
      shouldShutdown: true
    })
    expect(decisions.repeated).toEqual({
      result: { _tag: 'Applied', operationId: 'stop-once' },
      shouldShutdown: false
    })
    expect(decisions.competing.result._tag).toBe('PreconditionFailed')
    expect(decisions.competing.shouldShutdown).toBe(false)
  })

  it('publishes concurrent observation sources in contiguous sequence order', async () => {
    const sequences = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const logger = yield* makeAgentLogger(8_192)
          const session = yield* makeAgentSession('c'.repeat(43), 128, logger)
          yield* session.claim('c'.repeat(43))
          yield* session.open(AGENT_PROTOCOL)
          const observations = yield* session.observations(undefined).pipe(
            Stream.take(101),
            Stream.runCollect,
            Effect.forkScoped
          )
          yield* Effect.all(
            Array.from({ length: 50 }, (_, index) =>
              session.publishRepositoryChanged({
                _tag: 'RepositoryChanged',
                nativePath: `/repository/${index}`,
                aspects: ['workingCopy']
              })
            ),
            { concurrency: 'unbounded' }
          ).pipe(
            Effect.zip(
              Effect.all(Array.from({ length: 50 }, () => session.publishHeartbeat), {
                concurrency: 'unbounded'
              }),
              { concurrent: true }
            )
          )
          return Array.from(yield* Fiber.join(observations), (observation) => observation.sequence)
        })
      )
    )

    expect(sequences).toEqual(Array.from({ length: 101 }, (_, index) => index + 1))
  })
})
