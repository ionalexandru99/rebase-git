import {
  createBinaryMessageReassembler,
  RepositoryHistoryClientMessage,
  type RepositoryHistoryFailed,
} from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import { sendEnvironmentSocketMessage } from "#web/features/environment-connection/websocket/environment-socket";
import {
  RepositoryHistoryRejected,
  type RepositoryHistoryTransport,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

export function createRepositoryHistoryTransport(
  socket: WebSocket,
  enabled: boolean,
) {
  const requests = new Map<string, PendingRequest>();
  const reassembler = createBinaryMessageReassembler();

  const read: RepositoryHistoryTransport["read"] = (request) =>
    Effect.gen(function* () {
      if (!enabled) return yield* new RepositoryHistoryUnavailable();
      const requestId = crypto.randomUUID();
      const result = yield* Deferred.make<
        Uint8Array,
        | EnvironmentConnectionFailure
        | RepositoryHistoryRejected
        | RepositoryHistoryUnavailable
      >();
      requests.set(requestId, { result });
      yield* sendEnvironmentSocketMessage(
        socket,
        RepositoryHistoryClientMessage,
        { _tag: "ReadRepositoryHistory", ...request, requestId },
      );
      return yield* Deferred.await(result).pipe(
        Effect.onInterrupt(() =>
          sendEnvironmentSocketMessage(socket, RepositoryHistoryClientMessage, {
            _tag: "CancelRepositoryHistory",
            requestId,
          }).pipe(Effect.ignore),
        ),
        Effect.ensuring(Effect.sync(() => requests.delete(requestId))),
      );
    });

  return {
    acceptBinary(frame: Uint8Array) {
      return Effect.try({
        try: () => reassembler.accept(frame),
        catch: () => environmentResponseError("WebSocket"),
      }).pipe(
        Effect.flatMap((message) => {
          if (message === undefined) return Effect.void;
          const pending = requests.get(message.requestId);
          return pending === undefined
            ? Effect.fail(environmentResponseError("WebSocket"))
            : Deferred.succeed(pending.result, message.payload);
        }),
      );
    },
    acceptFailure(message: RepositoryHistoryFailed) {
      const pending = requests.get(message.requestId);
      return pending === undefined
        ? Effect.fail(environmentResponseError("WebSocket"))
        : Deferred.fail(
            pending.result,
            new RepositoryHistoryRejected({ failure: message.failure }),
          );
    },
    close(failure: EnvironmentConnectionFailure) {
      return Effect.forEach(
        requests.values(),
        (pending) => Deferred.fail(pending.result, failure),
        { discard: true },
      ).pipe(Effect.andThen(Effect.sync(() => requests.clear())));
    },
    read,
  };
}

export type RepositoryHistoryTransportRuntime = ReturnType<
  typeof createRepositoryHistoryTransport
>;

interface PendingRequest {
  readonly result: Deferred.Deferred<
    Uint8Array,
    | EnvironmentConnectionFailure
    | RepositoryHistoryRejected
    | RepositoryHistoryUnavailable
  >;
}
