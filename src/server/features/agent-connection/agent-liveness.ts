import { Deferred, Effect, Ref, type Scope } from 'effect4'
import type { AgentConnectionStatus, AgentProcessExit } from './agent-connection'
import { AgentConnectionFailure, type AgentProcessMonitorError } from './agent-connection-failure'

export interface AgentLiveness {
  readonly status: Effect.Effect<AgentConnectionStatus>
  readonly failureWhenUnavailable: Effect.Effect<never, AgentConnectionFailure>
  readonly disconnect: (
    status: Exclude<AgentConnectionStatus, { _tag: 'Connected' }>
  ) => Effect.Effect<void>
  readonly whileConnected: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | AgentConnectionFailure, R>
}

function disconnectedFailure(status: AgentConnectionStatus): AgentConnectionFailure {
  switch (status._tag) {
    case 'Connected':
      return new AgentConnectionFailure({
        reason: 'TransportFailed',
        message: 'Agent connection became unavailable'
      })
    case 'StopRequested':
      return new AgentConnectionFailure({
        reason: 'AgentStopping',
        message: 'Agent shutdown has already been requested'
      })
    case 'Exited':
      return new AgentConnectionFailure({
        reason: 'AgentExited',
        message: `Agent exited (code ${status.exit.code}, signal ${status.exit.signal ?? 'none'})`,
        detail: status.exit
      })
    case 'MonitoringFailed':
      return new AgentConnectionFailure({
        reason: 'MonitorFailed',
        message: status.error.message,
        detail: status.error.detail
      })
    case 'Unreachable':
      return status.failure
    case 'Released':
      return new AgentConnectionFailure({
        reason: 'ConnectionReleased',
        message: 'Agent connection scope has been released'
      })
  }
}

export function acquireAgentLiveness(
  agentExited: Effect.Effect<AgentProcessExit, AgentProcessMonitorError>
): Effect.Effect<AgentLiveness, never, Scope.Scope> {
  return Effect.gen(function* () {
    const state = yield* Ref.make<AgentConnectionStatus>({ _tag: 'Connected' })
    const unavailable = yield* Deferred.make<AgentConnectionStatus>()

    const disconnect: AgentLiveness['disconnect'] = (nextStatus) =>
      Ref.modify(state, (currentStatus) =>
        currentStatus._tag === 'Connected' ? [true, nextStatus] : [false, currentStatus]
      ).pipe(
        Effect.flatMap((changed) =>
          changed ? Deferred.succeed(unavailable, nextStatus).pipe(Effect.asVoid) : Effect.void
        )
      )

    const failureWhenUnavailable = Deferred.await(unavailable).pipe(
      Effect.flatMap((status) => Effect.fail(disconnectedFailure(status)))
    )

    const whileConnected: AgentLiveness['whileConnected'] = (effect) =>
      Ref.get(state).pipe(
        Effect.flatMap((currentStatus) =>
          currentStatus._tag === 'Connected'
            ? Effect.raceFirst(effect, failureWhenUnavailable)
            : Effect.fail(disconnectedFailure(currentStatus))
        )
      )

    yield* agentExited.pipe(
      Effect.matchEffect({
        onFailure: (error) => disconnect({ _tag: 'MonitoringFailed', error }),
        onSuccess: (exit) => disconnect({ _tag: 'Exited', exit })
      }),
      Effect.forkScoped
    )
    yield* Effect.addFinalizer(() => disconnect({ _tag: 'Released' }))

    return {
      status: Ref.get(state),
      failureWhenUnavailable,
      disconnect,
      whileConnected
    }
  })
}
