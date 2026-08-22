import { Deferred, Effect, Ref } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";

export interface EnvironmentConnectionState {
  readonly currentSequence: number;
  readonly failure: EnvironmentConnectionFailure | undefined;
  readonly waiters: ReadonlyArray<SequenceWaiter>;
}

interface SequenceWaiter {
  readonly deferred: Deferred.Deferred<number, EnvironmentConnectionFailure>;
  readonly sequence: number;
}

export function createEnvironmentConnectionState(initialSequence: number) {
  return Ref.make<EnvironmentConnectionState>({
    currentSequence: initialSequence,
    failure: undefined,
    waiters: [],
  });
}

export function waitForEnvironmentSequence(
  state: Ref.Ref<EnvironmentConnectionState>,
  sequence: number,
) {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<
      number,
      EnvironmentConnectionFailure
    >();
    const current = yield* Ref.modify(state, (value) => {
      if (value.failure !== undefined) {
        return [Effect.fail(value.failure), value];
      }
      if (value.currentSequence >= sequence) {
        return [Effect.succeed(value.currentSequence), value];
      }
      return [
        Deferred.await(deferred),
        {
          ...value,
          waiters: [...value.waiters, { deferred, sequence }],
        },
      ];
    });
    return yield* current;
  });
}

export function updateEnvironmentSequence(
  state: Ref.Ref<EnvironmentConnectionState>,
  sequence: number,
) {
  return Effect.gen(function* () {
    const completed = yield* Ref.modify(state, (value) => {
      const waiters = value.waiters.filter(
        (waiter) => waiter.sequence <= sequence,
      );
      return [
        waiters,
        {
          ...value,
          currentSequence: sequence,
          waiters: value.waiters.filter((waiter) => waiter.sequence > sequence),
        },
      ];
    });
    yield* Effect.forEach(completed, (waiter) =>
      Deferred.succeed(waiter.deferred, sequence),
    );
  });
}

export function terminateEnvironmentConnection(
  connected: Deferred.Deferred<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure
  >,
  state: Ref.Ref<EnvironmentConnectionState>,
  failure: EnvironmentConnectionFailure,
) {
  return Effect.gen(function* () {
    const waiters = yield* Ref.modify(state, (value) => [
      value.waiters,
      { ...value, failure, waiters: [] },
    ]);
    yield* Deferred.fail(connected, failure);
    yield* Effect.forEach(waiters, (waiter) =>
      Deferred.fail(waiter.deferred, failure),
    );
  });
}
