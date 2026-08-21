import { Deferred, Effect, Fiber, Ref } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";
import {
  createEnvironmentConnectionState,
  terminateEnvironmentConnection,
  updateEnvironmentSequence,
  waitForEnvironmentSequence,
} from "#web/features/environment-connection/websocket/environment-connection-state";

describe("Environment connection state", () => {
  it("returns the current sequence immediately when the target was observed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* createEnvironmentConnectionState(5);

        expect(yield* waitForEnvironmentSequence(state, 4)).toBe(5);
        expect((yield* Ref.get(state)).waiters).toEqual([]);
      }),
    );
  });

  it("resolves multiple waiters when their sequence thresholds are reached", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* createEnvironmentConnectionState(1);
        const lower = yield* waitForEnvironmentSequence(state, 2).pipe(
          Effect.forkChild,
        );
        const higher = yield* waitForEnvironmentSequence(state, 4).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        expect(
          (yield* Ref.get(state)).waiters.map(({ sequence }) => sequence),
        ).toEqual([2, 4]);

        yield* updateEnvironmentSequence(state, 2);
        expect(yield* Fiber.join(lower)).toBe(2);
        expect(
          (yield* Ref.get(state)).waiters.map(({ sequence }) => sequence),
        ).toEqual([4]);

        yield* updateEnvironmentSequence(state, 4);
        expect(yield* Fiber.join(higher)).toBe(4);
      }),
    );
  });

  it("fails pending and future waiters when the connection terminates", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* createEnvironmentConnectionState(0);
        const connected = yield* Deferred.make<
          EnvironmentProtocolConnection,
          EnvironmentConnectionFailure
        >();
        const pending = yield* waitForEnvironmentSequence(state, 1).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        expect(
          (yield* Ref.get(state)).waiters.map(({ sequence }) => sequence),
        ).toEqual([1]);
        const failure = environmentResponseError("WebSocket");

        yield* terminateEnvironmentConnection(connected, state, failure);

        expect(yield* Fiber.join(pending).pipe(Effect.flip)).toEqual(failure);
        expect(
          yield* waitForEnvironmentSequence(state, 1).pipe(Effect.flip),
        ).toEqual(failure);
      }),
    );
  });
});
