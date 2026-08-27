import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { Effect } from "effect";
import { applyRepositoryCheckout } from "#web/features/repository-refs/apply-repository-checkout";
import {
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";
import {
  type RepositoryRefsController,
  type RepositoryRefsControllerError,
  type RepositoryRefsGateway,
  type RepositoryRefsSnapshot,
  RepositoryRefsUnavailable,
} from "#web/features/repository-refs/repository-refs-controller.contract";

const idleSnapshot: RepositoryRefsSnapshot = {
  checkingOut: false,
  status: "idle",
};

export function createRepositoryRefsController(gateway: RepositoryRefsGateway) {
  const listeners = new Set<() => void>();
  const cache = new Map<string, RepositoryRefs>();
  const stale = new Set<string>();
  let credential: string | undefined;
  let snapshot = idleSnapshot;
  let generation = 0;
  let loading: Promise<void> | undefined;
  let invalidated = false;

  const publish = (next: RepositoryRefsSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const load = (repositoryId: string, loadGeneration: number) => {
    invalidated = false;
    return readRefs(repositoryId)
      .then(
        (refs) => {
          cache.set(repositoryId, refs);
          stale.delete(repositoryId);
          if (loadGeneration === generation) publish(withRefs(snapshot, refs));
        },
        (error: unknown) => {
          if (loadGeneration === generation) {
            publish(withError(snapshot, normalizeControllerError(error)));
          }
        },
      )
      .finally(() => {
        loading = undefined;
        if (invalidated && loadGeneration === generation) {
          loading = load(repositoryId, loadGeneration);
        }
      });
  };

  const readRefs = (repositoryId: string) =>
    credential === undefined
      ? Promise.reject(new RepositoryRefsUnavailable())
      : Effect.runPromise(gateway.read(credential, repositoryId));

  const startLoad = () => {
    const repositoryId = snapshot.repositoryId;
    if (repositoryId === undefined) return Promise.resolve();
    if (loading !== undefined) {
      invalidated = true;
      return loading;
    }
    loading = load(repositoryId, generation);
    return loading;
  };

  const checkout = async (
    worktreePath: string,
    target: RepositoryRefTarget,
  ) => {
    const repositoryId = snapshot.repositoryId;
    const authorizedCredential = credential;
    if (repositoryId === undefined || authorizedCredential === undefined) {
      throw new RepositoryRefsUnavailable();
    }
    publish({ ...withoutCheckoutError(snapshot), checkingOut: true });
    try {
      const result = await Effect.runPromise(
        gateway.checkout(authorizedCredential, {
          repositoryId,
          target,
          worktreePath,
        }),
      );
      const cached = cache.get(repositoryId);
      const refs =
        cached === undefined
          ? undefined
          : applyRepositoryCheckout(cached, result);
      if (refs !== undefined) cache.set(repositoryId, refs);
      publish(
        refs === undefined || snapshot.repositoryId !== repositoryId
          ? { ...snapshot, checkingOut: false }
          : { ...withRefs(snapshot, refs), checkingOut: false },
      );
      return result;
    } catch (error) {
      const checkoutError = normalizeControllerError(error);
      publish({ ...snapshot, checkingOut: false, checkoutError });
      throw checkoutError;
    }
  };

  const controller: RepositoryRefsController = {
    checkout,
    getSnapshot: () => snapshot,
    invalidate: () => {
      for (const repositoryId of cache.keys()) stale.add(repositoryId);
      void startLoad();
    },
    refresh: startLoad,
    select: (repositoryId) => {
      if (repositoryId === snapshot.repositoryId) return;
      generation += 1;
      loading = undefined;
      if (repositoryId === undefined) {
        publish(idleSnapshot);
        return;
      }
      const cached = cache.get(repositoryId);
      publish(
        cached === undefined
          ? { checkingOut: false, repositoryId, status: "loading" }
          : { checkingOut: false, refs: cached, repositoryId, status: "ready" },
      );
      if (cached === undefined || stale.has(repositoryId)) void startLoad();
    },
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

function withRefs(
  snapshot: RepositoryRefsSnapshot,
  refs: RepositoryRefs,
): RepositoryRefsSnapshot {
  const { error: _error, ...retained } = snapshot;
  return { ...retained, refs, status: "ready" };
}

function withError(
  snapshot: RepositoryRefsSnapshot,
  error: RepositoryRefsControllerError,
): RepositoryRefsSnapshot {
  return { ...snapshot, error, status: "error" };
}

function withoutCheckoutError(
  snapshot: RepositoryRefsSnapshot,
): RepositoryRefsSnapshot {
  const { checkoutError: _checkoutError, ...retained } = snapshot;
  return retained;
}

function normalizeControllerError(
  error: unknown,
): RepositoryRefsControllerError {
  if (
    error instanceof RepositoryRefsRejected ||
    error instanceof RepositoryRefsResponseError ||
    error instanceof RepositoryRefsUnavailable
  ) {
    return error;
  }
  return new RepositoryRefsResponseError();
}
