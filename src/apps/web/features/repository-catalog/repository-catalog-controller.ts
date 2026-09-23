import type { RepositoryCatalogEntry } from "@rebase/contracts";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  type ManagedRuntime,
  Scope,
  Semaphore,
} from "effect";
import {
  RepositoryCatalogRejected,
  RepositoryCatalogResponseError,
} from "#web/features/repository-catalog/repository-catalog-client.contract";
import type {
  RepositoryCatalogController,
  RepositoryCatalogControllerError,
  RepositoryCatalogControllerSnapshot,
  RepositoryCatalogGateway,
} from "#web/features/repository-catalog/repository-catalog-controller.contract";
import { RepositoryCatalogUnavailable } from "#web/features/repository-catalog/repository-catalog-controller.contract";

export function createRepositoryCatalogController(
  gateway: RepositoryCatalogGateway,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  const listeners = new Set<() => void>();
  let snapshot: RepositoryCatalogControllerSnapshot = {
    repositories: [],
    status: "idle",
  };
  let owner: Scope.Closeable | undefined;
  const operations = Semaphore.makeUnsafe(1);

  const publish = (next: RepositoryCatalogControllerSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const run = <Value>(
    operation: () => Effect.Effect<Value, RepositoryCatalogControllerError>,
    update: (
      repositories: readonly RepositoryCatalogEntry[],
      value: Value,
    ) => readonly RepositoryCatalogEntry[],
  ): Promise<Value> => {
    const scope = owner;
    if (scope === undefined) {
      const error = new RepositoryCatalogUnavailable();
      publish({ ...snapshot, error, status: "error" });
      return Promise.reject(error);
    }
    return runtime.runPromise(
      operations
        .withPermit(
          Effect.gen(function* () {
            if (owner !== scope) {
              return yield* Effect.interrupt;
            }
            publish({ repositories: snapshot.repositories, status: "loading" });
            const value = yield* operation();
            if (owner !== scope) {
              return yield* Effect.interrupt;
            }
            publish({
              repositories: sortRepositories(
                update(snapshot.repositories, value),
              ),
              status: "ready",
            });
            return value;
          }).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterrupts(cause) || owner !== scope) {
                return Effect.failCause(cause);
              }
              const error = normalizeControllerError(Cause.squash(cause));
              publish({
                error,
                repositories: snapshot.repositories,
                status: "error",
              });
              return Effect.fail(error);
            }),
          ),
        )
        .pipe(Effect.forkIn(scope), Effect.flatMap(Fiber.join)),
    );
  };

  const controller: RepositoryCatalogController = {
    getSnapshot: () => snapshot,
    recordOpened: (repositoryId) =>
      run(() => gateway.recordOpened(repositoryId), replaceRepository),
    refresh: () =>
      run(
        () => gateway.list(),
        (_repositories, listed) => listed,
      ).then(() => undefined),
    remember: (path) => run(() => gateway.remember(path), replaceRepository),
    remove: (repositoryId) =>
      run(
        () => gateway.remove(repositoryId),
        (repositories) =>
          repositories.filter((repository) => repository.id !== repositoryId),
      ).then(() => undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    connect: () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          owner = Scope.makeUnsafe();
          return owner;
        }),
        (scope) =>
          Effect.suspend(() => {
            if (owner === scope) owner = undefined;
            return Scope.close(scope, Exit.void);
          }),
      ).pipe(Effect.asVoid),
    controller,
  };
}

function replaceRepository(
  repositories: readonly RepositoryCatalogEntry[],
  replacement: RepositoryCatalogEntry,
) {
  return [
    ...repositories.filter((repository) => repository.id !== replacement.id),
    replacement,
  ];
}

function sortRepositories(repositories: readonly RepositoryCatalogEntry[]) {
  return [...repositories].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.path.localeCompare(right.path),
  );
}

function normalizeControllerError(
  error: unknown,
): RepositoryCatalogControllerError {
  if (
    error instanceof RepositoryCatalogRejected ||
    error instanceof RepositoryCatalogResponseError ||
    error instanceof RepositoryCatalogUnavailable
  ) {
    return error;
  }
  return new RepositoryCatalogResponseError();
}
