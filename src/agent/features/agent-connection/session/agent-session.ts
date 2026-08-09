import { randomBytes } from 'node:crypto'
import {
  AGENT_PROTOCOL,
  AGENT_SESSION_AUTHORIZATION_SCHEME,
  AgentClaimRejected,
  AgentHandshakeRequired,
  type AgentObservation,
  AgentProtocolMismatch,
  AgentShuttingDown,
  type StopAgentExpectedState
} from '@common/features/agent-connection'
import { Clock, Effect, PubSub, Ref, type Scope, Semaphore, Stream } from 'effect4'
import type { AgentLogger } from '../logging/redacted-agent-logger'
import {
  type AgentObservationDraft,
  type AgentSessionState,
  type AgentStopDecision,
  advanceObservation,
  authorizeSession,
  beginSessionShutdown,
  claimSession,
  completeSessionShutdown,
  initialSessionState,
  openSession,
  requireRunningSession,
  stopSession,
  touchSession
} from './session-state'

type RepositoryChanged = Omit<Extract<AgentObservation, { _tag: 'RepositoryChanged' }>, 'sequence'>

export interface AgentSession {
  readonly claim: (providedSecret: string) => Effect.Effect<string, AgentClaimRejected>
  readonly authorize: (authorization: string | undefined) => Effect.Effect<boolean>
  readonly open: (
    agentProtocol: number
  ) => Effect.Effect<void, AgentProtocolMismatch | AgentShuttingDown>
  readonly requireRunning: Effect.Effect<void, AgentHandshakeRequired | AgentShuttingDown>
  readonly currentSequence: Effect.Effect<number, AgentHandshakeRequired | AgentShuttingDown>
  readonly observations: (
    afterSequence: number | undefined
  ) => Stream.Stream<AgentObservation, AgentHandshakeRequired | AgentShuttingDown>
  readonly publishHeartbeat: Effect.Effect<void>
  readonly publishRepositoryChanged: (change: RepositoryChanged) => Effect.Effect<void>
  readonly requestStop: (
    operationId: string,
    expectedState: StopAgentExpectedState
  ) => Effect.Effect<AgentStopDecision, AgentHandshakeRequired>
  readonly beginShutdown: Effect.Effect<void>
  readonly completeShutdown: Effect.Effect<void>
  readonly inactiveFor: Effect.Effect<number>
}

export function makeAgentSession(
  bootstrapSecret: string,
  streamBufferEvents: number,
  logger: AgentLogger
): Effect.Effect<AgentSession, never, Scope.Scope> {
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const state = yield* Ref.make<AgentSessionState>(
      initialSessionState(bootstrapSecret, startedAt)
    )
    const observationStream = yield* PubSub.sliding<AgentObservation>({
      capacity: streamBufferEvents,
      replay: streamBufferEvents
    })
    const publicationLock = yield* Semaphore.make(1)
    yield* Effect.addFinalizer(() => PubSub.shutdown(observationStream))

    const publish = (observation: AgentObservationDraft): Effect.Effect<void> =>
      publicationLock.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const next = yield* Ref.modify(state, (current) =>
              advanceObservation(current, observation)
            )
            if (next) {
              yield* PubSub.publish(observationStream, next)
            }
          })
        )
      )

    const touch = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      yield* Ref.update(state, (current) => touchSession(current, now))
    })

    const requireRunning = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const transition = yield* Ref.modify(state, (current) => requireRunningSession(current, now))
      if (transition === 'HandshakeRequired') {
        return yield* new AgentHandshakeRequired()
      }
      if (transition === 'ShuttingDown') {
        return yield* new AgentShuttingDown()
      }
    })

    return {
      claim: (providedSecret) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const sessionToken = randomBytes(32).toString('base64url')
          const result = yield* Ref.modify(state, (current) =>
            claimSession(current, providedSecret, sessionToken, now)
          )
          if (result._tag === 'Rejected') {
            return yield* new AgentClaimRejected({ reason: result.reason })
          }
          yield* logger.registerSecret(sessionToken)
          return sessionToken
        }),
      authorize: (authorization) =>
        Effect.gen(function* () {
          if (!authorization) {
            return false
          }
          const now = yield* Clock.currentTimeMillis
          return yield* Ref.modify(state, (current) =>
            authorizeSession(
              current,
              authorization,
              (sessionToken) => `${AGENT_SESSION_AUTHORIZATION_SCHEME} ${sessionToken}`,
              now
            )
          )
        }),
      open: (agentProtocol) =>
        Effect.gen(function* () {
          if (agentProtocol !== AGENT_PROTOCOL) {
            return yield* new AgentProtocolMismatch({
              expected: AGENT_PROTOCOL,
              received: agentProtocol
            })
          }
          const now = yield* Clock.currentTimeMillis
          const transition = yield* Ref.modify(state, (current) => openSession(current, now))
          if (transition === 'ShuttingDown') {
            return yield* new AgentShuttingDown()
          }
          if (transition === 'Opened') {
            yield* publish({ _tag: 'Heartbeat' })
          }
        }),
      requireRunning,
      currentSequence: requireRunning.pipe(
        Effect.andThen(Ref.get(state)),
        Effect.map((current) => Math.max(1, current.sequence))
      ),
      observations: (afterSequence) =>
        Stream.unwrap(
          requireRunning.pipe(
            Effect.as(
              Stream.fromPubSub(observationStream).pipe(
                Stream.filter(
                  (observation) =>
                    afterSequence === undefined || observation.sequence > afterSequence
                ),
                Stream.tap(() => touch)
              )
            )
          )
        ),
      publishHeartbeat: publish({ _tag: 'Heartbeat' }),
      publishRepositoryChanged: publish,
      requestStop: (operationId, expectedState) =>
        Ref.modify(state, (current) =>
          stopSession(current, operationId, expectedState.agentProtocol)
        ).pipe(
          Effect.flatMap((decision) =>
            decision === 'HandshakeRequired'
              ? Effect.fail(new AgentHandshakeRequired())
              : Effect.succeed(decision)
          )
        ),
      beginShutdown: Ref.update(state, beginSessionShutdown),
      completeShutdown: Ref.update(state, completeSessionShutdown),
      inactiveFor: Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = yield* Ref.get(state)
        return now - current.lastActivityAt
      })
    }
  })
}
