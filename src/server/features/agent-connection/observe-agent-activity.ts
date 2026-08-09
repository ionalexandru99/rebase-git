import type { AgentObservation } from '@common/features/agent-connection'
import { Cause, Effect, Ref, Stream } from 'effect4'
import { type AgentConnectionFailure, AgentSequenceGap } from './failure/agent-connection-failure'
import {
  classifyAgentCommunicationFailure,
  isRecoverableAgentCommunicationFailure,
  malformedAgentCommunication,
  shouldDisconnectAfterCommunicationFailure
} from './failure/classify-agent-communication-failure'
import type { AgentLiveness } from './lifecycle/agent-liveness'
import type { AgentInterfaceClient } from './session/establish-agent-session'

type RepositoryActivityFailure = AgentConnectionFailure | AgentSequenceGap
type SequenceAcceptance =
  | { readonly _tag: 'Accepted' }
  | { readonly _tag: 'Gap'; readonly expected: number; readonly received: number }

function acceptObservation(
  lastSequence: Ref.Ref<number | undefined>,
  observation: AgentObservation
): Effect.Effect<AgentObservation, AgentSequenceGap> {
  return Ref.modify<number | undefined, SequenceAcceptance>(lastSequence, (previous) => {
    const expected = previous === undefined ? undefined : previous + 1
    return expected === undefined || expected === observation.sequence
      ? [{ _tag: 'Accepted' as const }, observation.sequence]
      : [{ _tag: 'Gap' as const, expected, received: observation.sequence }, previous]
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === 'Accepted'
        ? Effect.succeed(observation)
        : Effect.fail(
            new AgentSequenceGap({
              expected: result.expected,
              received: result.received,
              requiresRefresh: true
            })
          )
    )
  )
}

export function observeAgentActivity(
  client: AgentInterfaceClient,
  liveness: AgentLiveness,
  streamBufferEvents: number,
  maxReconnects: number,
  reconnectDelayMs: number
): Stream.Stream<AgentObservation, RepositoryActivityFailure> {
  return Stream.unwrap(
    Ref.make<number | undefined>(undefined).pipe(
      Effect.map((lastSequence) => {
        const connect = (
          reconnects: number
        ): Stream.Stream<AgentObservation, RepositoryActivityFailure> => {
          const currentStream = Stream.unwrap(
            Ref.get(lastSequence).pipe(
              Effect.map((afterSequence) =>
                client
                  .observeAgent(afterSequence === undefined ? {} : { afterSequence }, {
                    streamBufferSize: streamBufferEvents
                  })
                  .pipe(
                    Stream.mapError((error) =>
                      classifyAgentCommunicationFailure(error, 'Agent activity observation')
                    ),
                    Stream.catchCause((cause) =>
                      Cause.hasDies(cause) && !Cause.hasInterrupts(cause)
                        ? Stream.fail(
                            malformedAgentCommunication(
                              Cause.squash(cause),
                              'Agent activity observation'
                            )
                          )
                        : Stream.failCause(cause)
                    ),
                    Stream.mapEffect((observation) => acceptObservation(lastSequence, observation))
                  )
              )
            )
          )

          return currentStream.pipe(
            Stream.catch((failure) => {
              if (failure instanceof AgentSequenceGap) {
                return Stream.fail(failure)
              }
              if (!isRecoverableAgentCommunicationFailure(failure)) {
                if (!shouldDisconnectAfterCommunicationFailure(failure)) {
                  return Stream.fail(failure)
                }
                return Stream.fromEffect(
                  liveness
                    .disconnect({ _tag: 'Unreachable', failure })
                    .pipe(Effect.andThen(Effect.fail(failure)))
                )
              }
              if (reconnects >= maxReconnects) {
                return Stream.fromEffect(
                  liveness
                    .disconnect({ _tag: 'Unreachable', failure })
                    .pipe(Effect.andThen(Effect.fail(failure)))
                )
              }
              return Stream.fromEffect(Effect.sleep(reconnectDelayMs)).pipe(
                Stream.drain,
                Stream.concat(connect(reconnects + 1))
              )
            })
          )
        }

        return connect(0).pipe(Stream.interruptWhen(liveness.failureWhenUnavailable))
      })
    )
  )
}
