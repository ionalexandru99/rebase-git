import { Effect } from "effect";
import {
  type RepositoryHistoryGateway,
  RepositoryHistoryOffline,
  type RepositoryHistoryTransport,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import type {
  RepositoryFreshnessGateway,
  RepositoryFreshnessTransport,
} from "#web/features/repository-history/transport/repository-freshness.contract";

export function createRepositoryHistoryGateway() {
  let transport: RepositoryHistoryTransport | undefined;
  const listeners = new Set<() => void>();
  const freshness = createRepositoryFreshnessGateway();
  const gateway: RepositoryHistoryGateway = {
    freshness: freshness.gateway,
    read: (request, signal) => {
      const current = transport;
      if (current === undefined)
        return Promise.reject(new RepositoryHistoryOffline());
      return Effect.runPromise(
        current.read(request),
        signal === undefined ? undefined : { signal },
      );
    },
    synchronize: (request, acceptBatch, signal) => {
      const current = transport;
      if (current === undefined)
        return Promise.reject(new RepositoryHistoryOffline());
      return Effect.runPromise(
        current.synchronize(request, (bytes) =>
          Effect.tryPromise({
            try: () => acceptBatch(bytes),
            catch: () => new RepositoryHistoryUnavailable(),
          }),
        ),
        signal === undefined ? undefined : { signal },
      );
    },
    subscribeAvailability: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    connect: (next: RepositoryHistoryTransport) => {
      transport = next;
      freshness.connect(next.freshness);
      for (const listener of listeners) listener();
    },
    disconnect: (current: RepositoryHistoryTransport) => {
      if (transport === current) {
        transport = undefined;
        freshness.disconnect();
      }
    },
    gateway,
  };
}

interface FreshnessSubscription {
  readonly repositoryId: string;
  readonly publish: Parameters<RepositoryFreshnessGateway["subscribe"]>[1];
  readonly fail: Parameters<RepositoryFreshnessGateway["subscribe"]>[2];
  controller?: AbortController;
}

function createRepositoryFreshnessGateway() {
  let transport: RepositoryFreshnessTransport | undefined;
  const subscriptions = new Set<FreshnessSubscription>();
  const observe = (subscription: FreshnessSubscription) => {
    subscription.controller?.abort();
    const current = transport;
    if (current === undefined) {
      subscription.fail(new RepositoryHistoryOffline());
      return;
    }
    const controller = new AbortController();
    subscription.controller = controller;
    void Effect.runPromise(
      current.observe(subscription.repositoryId, (state) => {
        if (!controller.signal.aborted) subscription.publish(state);
      }),
      { signal: controller.signal },
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) subscription.fail(error);
    });
  };
  const gateway: RepositoryFreshnessGateway = {
    subscribe: (repositoryId, publish, fail) => {
      const subscription: FreshnessSubscription = {
        repositoryId,
        publish,
        fail,
      };
      subscriptions.add(subscription);
      observe(subscription);
      return () => {
        subscription.controller?.abort();
        subscriptions.delete(subscription);
      };
    },
    fetch: (repositoryId, signal) =>
      transport === undefined
        ? Promise.reject(new RepositoryHistoryOffline())
        : Effect.runPromise(
            transport.fetch(repositoryId),
            signal === undefined ? undefined : { signal },
          ),
    configure: (repositoryId, setting, signal) =>
      transport === undefined
        ? Promise.reject(new RepositoryHistoryOffline())
        : Effect.runPromise(
            transport.configure(repositoryId, setting),
            signal === undefined ? undefined : { signal },
          ),
  };
  return {
    gateway,
    connect: (next: RepositoryFreshnessTransport | undefined) => {
      transport = next;
      for (const subscription of subscriptions) observe(subscription);
    },
    disconnect: () => {
      transport = undefined;
      for (const subscription of subscriptions) observe(subscription);
    },
  };
}
