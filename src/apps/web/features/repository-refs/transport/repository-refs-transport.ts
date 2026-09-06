import {
  createJsonMessageReassembler,
  RepositoryRefs,
  RepositoryRefsClientMessage,
} from "@rebase/contracts";
import { Deferred, Effect, Schema } from "effect";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import { createEnvironmentRequestId } from "#web/features/environment-connection/websocket/environment-request-id";
import { sendEnvironmentSocketMessage } from "#web/features/environment-connection/websocket/environment-socket";
import {
  type RepositoryRefsClientError,
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";
import type { RepositoryRefsTransportRuntime } from "#web/features/repository-refs/transport/repository-refs-transport.contract";

export function createRepositoryRefsTransport(
  socket: Pick<WebSocket, "send">,
  enabled: boolean,
): RepositoryRefsTransportRuntime {
  const requests = new Map<
    string,
    {
      readonly repositoryId: string;
      readonly result: Deferred.Deferred<
        RepositoryRefs,
        RepositoryRefsClientError
      >;
    }
  >();
  const reassembler = createJsonMessageReassembler();
  let closed = false;
  return {
    read: (repositoryId) =>
      Effect.gen(function* () {
        if (!enabled || closed) return yield* new RepositoryRefsResponseError();
        const requestId = createEnvironmentRequestId();
        const result = yield* Deferred.make<
          RepositoryRefs,
          RepositoryRefsClientError
        >();
        return yield* Effect.gen(function* () {
          requests.set(requestId, { repositoryId, result });
          yield* sendEnvironmentSocketMessage(
            socket,
            RepositoryRefsClientMessage,
            {
              _tag: "ReadRepositoryRefs",
              repositoryId,
              requestId,
            },
          ).pipe(Effect.mapError(() => new RepositoryRefsResponseError()));
          return yield* Deferred.await(result).pipe(
            Effect.timeout(30_000),
            Effect.catchTag("TimeoutError", () =>
              Effect.fail(new RepositoryRefsResponseError()),
            ),
          );
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              const pending = requests.delete(requestId);
              reassembler.discard(requestId);
              if (!closed && pending)
                yield* sendEnvironmentSocketMessage(
                  socket,
                  RepositoryRefsClientMessage,
                  {
                    _tag: "CancelRepositoryRefs",
                    requestId,
                  },
                ).pipe(Effect.ignore);
            }),
          ),
        );
      }),
    hasRequest: (requestId) => requests.has(requestId),
    acceptJson: (frame) =>
      Effect.gen(function* () {
        const pending = requests.get(frame.requestId);
        if (pending === undefined) return;
        const message = yield* Effect.try({
          try: () => reassembler.accept(frame),
          catch: () => environmentResponseError("WebSocket"),
        });
        if (message === undefined) return;
        const refs = yield* Effect.try({
          try: () =>
            Schema.decodeUnknownSync(RepositoryRefs)(
              JSON.parse(new TextDecoder().decode(message.payload)),
            ),
          catch: () => environmentResponseError("WebSocket"),
        });
        if (refs.repositoryId !== pending.repositoryId)
          return yield* Effect.fail(environmentResponseError("WebSocket"));
        requests.delete(frame.requestId);
        reassembler.discard(frame.requestId);
        yield* Deferred.succeed(pending.result, refs);
      }),
    acceptFailure: (message) =>
      Effect.gen(function* () {
        const pending = requests.get(message.requestId);
        if (pending === undefined) return;
        requests.delete(message.requestId);
        reassembler.discard(message.requestId);
        yield* Deferred.fail(
          pending.result,
          new RepositoryRefsRejected({
            failure: message.failure,
            status:
              message.failure._tag === "CapabilityDenied"
                ? 403
                : message.failure._tag === "RepositoryMissing"
                  ? 404
                  : 422,
          }),
        );
      }),
    close: Effect.gen(function* () {
      closed = true;
      yield* Effect.forEach(
        requests.values(),
        (pending) =>
          Deferred.fail(pending.result, new RepositoryRefsResponseError()),
        { discard: true },
      );
      requests.clear();
      reassembler.clear();
    }),
  };
}
