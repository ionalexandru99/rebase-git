import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { applyRepositoryCheckout } from "#web/features/repository-refs/apply-repository-checkout";
import {
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";
import {
  RepositoryRefsBusy,
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
  let credential: EnvironmentCredential | undefined;
  let snapshot = idleSnapshot;
  const loading = new Map<string, Promise<void>>();
  let checkoutInFlight = false;

  const publish = (next: RepositoryRefsSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const load = (repositoryId: string) => {
    stale.delete(repositoryId);
    let failed = false;
    const pending = readRefs(repositoryId)
      .then(
        (refs) => {
          cache.set(repositoryId, refs);
          if (snapshot.repositoryId === repositoryId)
            publish(withRefs(snapshot, refs));
        },
        (error: unknown) => {
          failed = true;
          if (snapshot.repositoryId === repositoryId) {
            publish(withError(snapshot, normalizeControllerError(error)));
          }
        },
      )
      .finally(() => {
        loading.delete(repositoryId);
        const invalidated = stale.has(repositoryId);
        if (failed) stale.add(repositoryId);
        if (invalidated && snapshot.repositoryId === repositoryId) {
          void load(repositoryId);
        }
      });
    loading.set(repositoryId, pending);
    return pending;
  };

  const readRefs = (repositoryId: string) =>
    credential === undefined
      ? Promise.reject(new RepositoryRefsUnavailable())
      : Effect.runPromise(gateway.read(credential, repositoryId));

  const startLoad = () => {
    const repositoryId = snapshot.repositoryId;
    if (repositoryId === undefined) return Promise.resolve();
    const pending = loading.get(repositoryId);
    if (pending !== undefined) {
      stale.add(repositoryId);
      return pending;
    }
    return load(repositoryId);
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
    if (checkoutInFlight) throw new RepositoryRefsBusy();
    checkoutInFlight = true;
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
      if (snapshot.repositoryId === repositoryId) {
        publish(
          refs === undefined
            ? { ...snapshot, checkingOut: false }
            : { ...withRefs(snapshot, refs), checkingOut: false },
        );
      }
      return result;
    } catch (error) {
      const checkoutError = normalizeControllerError(error);
      if (snapshot.repositoryId === repositoryId) {
        publish({ ...snapshot, checkingOut: false, checkoutError });
      }
      throw checkoutError;
    } finally {
      checkoutInFlight = false;
    }
  };

  const controller: RepositoryRefsController = {
    checkout,
    getSnapshot: () => snapshot,
    invalidate: (repositoryIds) => {
      for (const repositoryId of repositoryIds ?? [
        ...cache.keys(),
        ...loading.keys(),
      ])
        stale.add(repositoryId);
      if (
        repositoryIds === undefined ||
        (snapshot.repositoryId !== undefined &&
          repositoryIds.includes(snapshot.repositoryId))
      )
        void startLoad();
    },
    refresh: startLoad,
    select: (repositoryId) => {
      if (repositoryId === snapshot.repositoryId) return;
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
      if (
        (cached === undefined || stale.has(repositoryId)) &&
        !loading.has(repositoryId)
      )
        void load(repositoryId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    authorize: (nextCredential: EnvironmentCredential) => {
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
    error instanceof RepositoryRefsBusy ||
    error instanceof RepositoryRefsRejected ||
    error instanceof RepositoryRefsResponseError ||
    error instanceof RepositoryRefsUnavailable
  ) {
    return error;
  }
  return new RepositoryRefsResponseError();
}
