import { Deferred, Effect, Fiber } from "effect";
import { expect, it } from "vite-plus/test";
import { createHistorySyncScheduler } from "#web/features/repository-history/transport/history-sync-scheduler";

it("prioritizes visible history and skips cancelled background work", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const schedule = createHistorySyncScheduler();
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const order: string[] = [];
      const active = yield* schedule(
        "background",
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const cancelled = yield* schedule(
        "background",
        Effect.sync(() => order.push("cancelled")),
      ).pipe(Effect.forkScoped);
      const background = yield* schedule(
        "background",
        Effect.sync(() => order.push("background")),
      ).pipe(Effect.forkScoped);
      const visible = yield* schedule(
        "visible",
        Effect.sync(() => order.push("visible")),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(cancelled);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(active);
      yield* Fiber.join(background);
      yield* Fiber.join(visible);
      expect(order).toEqual(["visible", "background"]);
    }).pipe(Effect.scoped),
  ));
