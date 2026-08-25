import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Effect } from "effect";
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
  let credential: string | undefined;
  let snapshot: RepositoryCatalogControllerSnapshot = {
    repositories: [],
    status: "idle",
  };
  let operationQueue = Promise.resolve();

  const publish = (next: RepositoryCatalogControllerSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const enqueue = <Value>(operation: () => Promise<Value>) => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const run = <Value>(
    operation: (
      authorizedCredential: string,
    ) => Effect.Effect<Value, RepositoryCatalogControllerError>,
    update: (
      repositories: readonly RepositoryCatalogEntry[],
      value: Value,
    ) => readonly RepositoryCatalogEntry[],
  ) =>
    enqueue(async () => {
      const authorizedCredential = credential;
      if (authorizedCredential === undefined) {
        const error = new RepositoryCatalogUnavailable();
        publish({ ...snapshot, error, status: "error" });
        throw error;
      }

      publish({ repositories: snapshot.repositories, status: "loading" });
      try {
        const value = await Effect.runPromise(operation(authorizedCredential));
        publish({
          repositories: sortRepositories(update(snapshot.repositories, value)),
          status: "ready",
        });
        return value;
      } catch (error) {
        const catalogError = normalizeControllerError(error);
        publish({
          error: catalogError,
          repositories: snapshot.repositories,
          status: "error",
        });
        throw catalogError;
      }
    });

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
    authorize: (nextCredential: string) => {
      credential = nextCredential;
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
