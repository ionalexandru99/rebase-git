import { Effect, Exit, Fiber, type ManagedRuntime, Scope } from "effect";

export function createControllerScope(
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  let owner: Scope.Closeable | undefined;
  return {
    get open() {
      return owner !== undefined;
    },
    start: () => {
      if (owner !== undefined) return false;
      owner = Scope.makeUnsafe();
      return true;
    },
    fork: <A, E>(effect: Effect.Effect<A, E>) =>
      owner === undefined
        ? undefined
        : runtime.runSync(Effect.forkIn(effect, owner)),
    interrupt: (fiber: Fiber.Fiber<unknown, unknown> | undefined) => {
      if (fiber !== undefined) runtime.runFork(Fiber.interrupt(fiber));
    },
    stop: () => {
      const scope = owner;
      owner = undefined;
      if (scope !== undefined) runtime.runFork(Scope.close(scope, Exit.void));
    },
  };
}

export type ControllerScope = ReturnType<typeof createControllerScope>;
