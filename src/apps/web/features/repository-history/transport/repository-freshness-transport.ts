import {
  type RepositoryFreshness,
  RepositoryFreshnessClientMessage,
  type RepositoryHistoryFreshness,
} from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import { createEnvironmentRequestId } from "#web/features/environment-connection/websocket/environment-request-id";
import { sendEnvironmentSocketMessage } from "#web/features/environment-connection/websocket/environment-socket";
import {
  RepositoryHistoryRejected,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import type {
  RepositoryFreshnessFailure,
  RepositoryFreshnessTransportRuntime,
} from "#web/features/repository-history/transport/repository-freshness.contract";

interface PendingCommand {
  readonly repositoryId: string;
  readonly result: Deferred.Deferred<
    RepositoryFreshness,
    RepositoryFreshnessFailure
  >;
}

interface Subscription {
  readonly repositoryId: string;
  readonly publish: (state: RepositoryFreshness) => void;
  readonly closed: Deferred.Deferred<never, RepositoryFreshnessFailure>;
}

export function createRepositoryFreshnessTransport(
  socket: Pick<WebSocket, "send">,
  enabled: boolean,
): RepositoryFreshnessTransportRuntime {
  const commands = new Map<string, PendingCommand>();
  const subscriptions = new Map<string, Subscription>();
  let closed = false;
  const execute = (
    command: Extract<
      RepositoryFreshnessClientMessage,
      { _tag: "FetchRepositoryHistory" | "ConfigureRepositoryFetch" }
    >,
  ) =>
    Effect.gen(function* () {
      if (!enabled || closed) return yield* new RepositoryHistoryUnavailable();
      const result = yield* Deferred.make<
        RepositoryFreshness,
        RepositoryFreshnessFailure
      >();
      commands.set(command.requestId, {
        repositoryId: command.repositoryId,
        result,
      });
      return yield* sendEnvironmentSocketMessage(
        socket,
        RepositoryFreshnessClientMessage,
        command,
      ).pipe(
        Effect.andThen(Deferred.await(result)),
        Effect.ensuring(
          Effect.sync(() => {
            commands.delete(command.requestId);
          }),
        ),
      );
    });
  const accept = (message: RepositoryHistoryFreshness) => {
    const command = commands.get(message.requestId);
    if (command !== undefined && command.repositoryId === message.repositoryId)
      return Deferred.succeed(command.result, message.freshness).pipe(
        Effect.asVoid,
      );
    return Effect.sync(() => {
      const subscription = subscriptions.get(message.requestId);
      if (subscription?.repositoryId === message.repositoryId)
        subscription.publish(message.freshness);
    });
  };
  return {
    observe: (repositoryId, publish) =>
      Effect.gen(function* () {
        if (!enabled || closed)
          return yield* new RepositoryHistoryUnavailable();
        const requestId = createEnvironmentRequestId();
        const ended = yield* Deferred.make<never, RepositoryFreshnessFailure>();
        subscriptions.set(requestId, { repositoryId, publish, closed: ended });
        return yield* sendEnvironmentSocketMessage(
          socket,
          RepositoryFreshnessClientMessage,
          { _tag: "SubscribeRepositoryHistory", repositoryId, requestId },
        ).pipe(
          Effect.andThen(Deferred.await(ended)),
          Effect.ensuring(
            Effect.suspend(() => {
              subscriptions.delete(requestId);
              return closed
                ? Effect.void
                : sendEnvironmentSocketMessage(
                    socket,
                    RepositoryFreshnessClientMessage,
                    { _tag: "UnsubscribeRepositoryHistory", repositoryId },
                  ).pipe(Effect.ignore);
            }),
          ),
        );
      }),
    fetch: (repositoryId) =>
      execute({
        _tag: "FetchRepositoryHistory",
        repositoryId,
        requestId: createEnvironmentRequestId(),
      }),
    configure: (repositoryId, setting) =>
      execute({
        _tag: "ConfigureRepositoryFetch",
        repositoryId,
        setting,
        requestId: createEnvironmentRequestId(),
      }),
    accept,
    acceptFailure: (message) => {
      const error = new RepositoryHistoryRejected({ failure: message.failure });
      const command = commands.get(message.requestId);
      if (command !== undefined)
        return Deferred.fail(command.result, error).pipe(Effect.asVoid);
      const subscription = subscriptions.get(message.requestId);
      return subscription === undefined
        ? Effect.void
        : Deferred.fail(subscription.closed, error).pipe(Effect.asVoid);
    },
    close: (error) =>
      Effect.gen(function* () {
        closed = true;
        yield* Effect.forEach(commands.values(), (command) =>
          Deferred.fail(command.result, error),
        );
        yield* Effect.forEach(subscriptions.values(), (subscription) =>
          Deferred.fail(subscription.closed, error),
        );
        commands.clear();
        subscriptions.clear();
      }),
  };
}
