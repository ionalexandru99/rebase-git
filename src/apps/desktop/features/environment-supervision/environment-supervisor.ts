import { startEnvironmentServer } from "@rebase/server";
import { Effect, Exit, Scope } from "effect";
import type { ManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor.contract";

export async function startManagedEnvironmentServer(): Promise<ManagedEnvironmentServer> {
  const scope = Scope.makeUnsafe();

  try {
    const server = await Effect.runPromise(
      Scope.provide(startEnvironmentServer(), scope),
    );
    let shutdown: Promise<void> | undefined;

    return {
      ...server,
      stop: () => {
        shutdown ??= Effect.runPromise(Scope.close(scope, Exit.void));
        return shutdown;
      },
    };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
}
