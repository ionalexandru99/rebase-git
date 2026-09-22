import type { RepositoryCatalogEntry } from "@rebase/contracts";
import type { EnvironmentCredential } from "@rebase/environment-client";
import { Cause, Effect, Layer, ManagedRuntime, Semaphore } from "effect";
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
) {
  const listeners = new Set<() => void>();
  let credential: EnvironmentCredential | undefined;
  let snapshot: RepositoryCatalogControllerSnapshot = {
    repositories: [],
    status: "idle",
  };
  let runtime: ManagedRuntime.ManagedRuntime<never, never> | undefined;
  const operations = Semaphore.makeUnsafe(1);

  const publish = (next: RepositoryCatalogControllerSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const run = <Value>(
    operation: (
      authorizedCredential: EnvironmentCredential,
    ) => Effect.Effect<Value, RepositoryCatalogControllerError>,
    update: (
      repositories: readonly RepositoryCatalogEntry[],
      value: Value,
    ) => readonly RepositoryCatalogEntry[],
  ): Promise<Value> => {
    const owner = runtime;
    const authorizedCredential = credential;
    if (owner === undefined || authorizedCredential === undefined) {
      const error = new RepositoryCatalogUnavailable();
      publish({ ...snapshot, error, status: "error" });
      return Promise.reject(error);
    }
    return owner.runPromise(
      operations.withPermit(
        Effect.gen(function* () {
          if (runtime !== owner) {
            return yield* Effect.interrupt;
          }
          publish({ repositories: snapshot.repositories, status: "loading" });
          const value = yield* operation(authorizedCredential);
          if (runtime !== owner) {
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
            if (Cause.hasInterrupts(cause) || runtime !== owner) {
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
      ),
    );
  };

  const controller: RepositoryCatalogController = {
    getSnapshot: () => snapshot,
    recordOpened: (repositoryId) =>
      run(
        (authorizedCredential) =>
          gateway.recordOpened(authorizedCredential, repositoryId),
        replaceRepository,
      ),
    refresh: () =>
      run(
        (authorizedCredential) => gateway.list(authorizedCredential),
        (_repositories, listed) => listed,
      ).then(() => undefined),
    remember: (path) =>
      run(
        (authorizedCredential) => gateway.remember(authorizedCredential, path),
        replaceRepository,
      ),
    remove: (repositoryId) =>
      run(
        (authorizedCredential) =>
          gateway.remove(authorizedCredential, repositoryId),
        (repositories) =>
          repositories.filter((repository) => repository.id !== repositoryId),
      ).then(() => undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    authorize: (nextCredential: EnvironmentCredential) => {
      credential = nextCredential;
      runtime ??= ManagedRuntime.make(Layer.empty);
    },
    stop: () => {
      const owner = runtime;
      runtime = undefined;
      credential = undefined;
      return owner?.dispose() ?? Promise.resolve();
    },
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
