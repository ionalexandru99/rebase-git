import {
  createBinaryMessageReassembler,
  RepositoryHistoryClientMessage,
  type RepositoryHistoryFailed,
  type RepositoryHistorySynchronized,
  readBinaryFragmentRequestId,
  readRepositoryHistoryBatchSequence,
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
import type { RepositoryHistoryTransportRuntime } from "#web/features/repository-history/repository-history-transport.contract";

type RequestFailure =
  | EnvironmentConnectionFailure
  | RepositoryHistoryRejected
  | RepositoryHistoryUnavailable;

export function createRepositoryHistoryTransport(
  socket: WebSocket,
  enabled: boolean,
  synchronizationEnabled = enabled,
): RepositoryHistoryTransportRuntime {
  const requests = new Map<string, PendingRequest>();
  const synchronizationQueue: string[] = [];
  const reassembler = createBinaryMessageReassembler();
  let activeSynchronization: string | undefined;

  const read: RepositoryHistoryTransport["read"] = (request) =>
    Effect.gen(function* () {
      if (!enabled) {
        return yield* new RepositoryHistoryUnavailable();
      }
      const requestId = crypto.randomUUID();
      const result = yield* Deferred.make<Uint8Array, RequestFailure>();
      return yield* Effect.gen(function* () {
        requests.set(requestId, { kind: "read", result });
        yield* sendEnvironmentSocketMessage(
          socket,
          RepositoryHistoryClientMessage,
          { _tag: "ReadRepositoryHistory", ...request, requestId },
        );
        return yield* Deferred.await(result);
      }).pipe(
        Effect.onInterrupt(() => cancelServerRequest(socket, requestId)),
        Effect.ensuring(cleanRequest(requests, reassembler, requestId)),
      );
    });

  const startNextSynchronization = (): Effect.Effect<
    void,
    EnvironmentConnectionFailure
  > => {
    if (activeSynchronization !== undefined) {
      return Effect.void;
    }
    const visibleIndex = synchronizationQueue.findIndex(
      (requestId) => requests.get(requestId)?.priority === "visible",
    );
    const [requestId] = synchronizationQueue.splice(
      visibleIndex < 0 ? 0 : visibleIndex,
      1,
    );
    if (requestId === undefined) {
      return Effect.void;
    }
    const pending = requests.get(requestId);
    if (pending?.kind !== "sync") {
      return startNextSynchronization();
    }
    activeSynchronization = requestId;
    return sendEnvironmentSocketMessage(
      socket,
      RepositoryHistoryClientMessage,
      {
        _tag: "SynchronizeRepositoryHistory",
        priority: pending.priority,
        repositoryId: pending.repositoryId,
        requestId,
      },
    ).pipe(
      Effect.tapError((failure) =>
        Deferred.fail(pending.result, failure).pipe(Effect.ignore),
      ),
    );
  };

  const finishSynchronization = (requestId: string) => {
    if (activeSynchronization === requestId) {
      activeSynchronization = undefined;
    }
    const queued = synchronizationQueue.indexOf(requestId);
    if (queued >= 0) {
      synchronizationQueue.splice(queued, 1);
    }
    return startNextSynchronization();
  };

  const synchronize: RepositoryHistoryTransport["synchronize"] = (
    request,
    acceptBatch,
  ) =>
    Effect.gen(function* () {
      if (!synchronizationEnabled) {
        return yield* new RepositoryHistoryUnavailable();
      }
      const requestId = crypto.randomUUID();
      const result = yield* Deferred.make<number, RequestFailure>();
      return yield* Effect.gen(function* () {
        requests.set(requestId, {
          acceptBatch,
          expectedSequence: 0,
          kind: "sync",
          priority: request.priority,
          repositoryId: request.repositoryId,
          result,
        });
        synchronizationQueue.push(requestId);
        yield* startNextSynchronization();
        return yield* Deferred.await(result);
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.suspend(() =>
            activeSynchronization === requestId
              ? cancelServerRequest(socket, requestId)
              : Effect.void,
          ),
        ),
        Effect.ensuring(
          Effect.suspend(() => finishSynchronization(requestId)).pipe(
            Effect.ignore,
          ),
        ),
        Effect.ensuring(cleanRequest(requests, reassembler, requestId)),
      );
    });

  return {
    acceptBinary(frame: Uint8Array) {
      return Effect.try({
        try: () => {
          const requestId = readBinaryFragmentRequestId(frame);
          if (!requests.has(requestId)) {
            reassembler.discard(requestId);
            return undefined;
          }
          return reassembler.accept(frame);
        },
        catch: () => environmentResponseError("WebSocket"),
      }).pipe(
        Effect.flatMap((message) => {
          if (message === undefined) {
            return Effect.void;
          }
          const pending = requests.get(message.requestId);
          if (pending === undefined) {
            reassembler.discard(message.requestId);
            return Effect.void;
          }
          if (pending.kind === "read") {
            return Deferred.succeed(pending.result, message.payload).pipe(
              Effect.asVoid,
            );
          }
          return Effect.try({
            try: () => readRepositoryHistoryBatchSequence(message.payload),
            catch: () => environmentResponseError("WebSocket"),
          }).pipe(
            Effect.flatMap((sequence) => {
              if (
                activeSynchronization !== message.requestId ||
                sequence !== pending.expectedSequence
              ) {
                return Effect.fail(environmentResponseError("WebSocket"));
              }
              return pending.acceptBatch(message.payload).pipe(
                Effect.andThen(
                  sendEnvironmentSocketMessage(
                    socket,
                    RepositoryHistoryClientMessage,
                    {
                      _tag: "AcknowledgeRepositoryHistoryBatch",
                      requestId: message.requestId,
                      sequence,
                    },
                  ).pipe(
                    Effect.tapError((failure) =>
                      Deferred.fail(pending.result, failure).pipe(
                        Effect.ignore,
                      ),
                    ),
                  ),
                ),
                Effect.tap(() =>
                  Effect.sync(() => {
                    pending.expectedSequence += 1;
                  }),
                ),
                Effect.catchTag("RepositoryHistoryUnavailable", (failure) =>
                  Deferred.fail(pending.result, failure).pipe(
                    Effect.andThen(
                      cancelServerRequest(socket, message.requestId),
                    ),
                    Effect.andThen(finishSynchronization(message.requestId)),
                    Effect.asVoid,
                  ),
                ),
              );
            }),
          );
        }),
      );
    },
    acceptFailure(message: RepositoryHistoryFailed) {
      const pending = requests.get(message.requestId);
      if (pending === undefined) {
        reassembler.discard(message.requestId);
        return Effect.void;
      }
      const failure = new RepositoryHistoryRejected({
        failure: message.failure,
      });
      if (pending.kind === "read") {
        return Deferred.fail(pending.result, failure).pipe(Effect.asVoid);
      }
      return Deferred.fail(pending.result, failure).pipe(
        Effect.andThen(finishSynchronization(message.requestId)),
        Effect.asVoid,
      );
    },
    acceptSynchronized(message: RepositoryHistorySynchronized) {
      const pending = requests.get(message.requestId);
      if (pending?.kind !== "sync") {
        return Effect.void;
      }
      return Deferred.succeed(pending.result, message.commitCount).pipe(
        Effect.andThen(finishSynchronization(message.requestId)),
        Effect.asVoid,
      );
    },
    close(failure: EnvironmentConnectionFailure) {
      return Effect.forEach(
        requests.values(),
        (pending) => failPendingRequest(pending, failure),
        { discard: true },
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            activeSynchronization = undefined;
            synchronizationQueue.length = 0;
            requests.clear();
            reassembler.clear();
          }),
        ),
      );
    },
    read,
    synchronize,
  };
}

function cancelServerRequest(socket: WebSocket, requestId: string) {
  return sendEnvironmentSocketMessage(socket, RepositoryHistoryClientMessage, {
    _tag: "CancelRepositoryHistory",
    requestId,
  }).pipe(Effect.ignore);
}

function cleanRequest(
  requests: Map<string, PendingRequest>,
  reassembler: ReturnType<typeof createBinaryMessageReassembler>,
  requestId: string,
) {
  return Effect.sync(() => {
    requests.delete(requestId);
    reassembler.discard(requestId);
  });
}

interface ReadRequest {
  readonly kind: "read";
  readonly result: Deferred.Deferred<Uint8Array, RequestFailure>;
  readonly priority?: undefined;
}

interface SynchronizationRequest {
  readonly acceptBatch: (
    bytes: Uint8Array,
  ) => Effect.Effect<void, RepositoryHistoryUnavailable>;
  expectedSequence: number;
  readonly kind: "sync";
  readonly priority: "background" | "visible";
  readonly repositoryId: string;
  readonly result: Deferred.Deferred<number, RequestFailure>;
}

type PendingRequest = ReadRequest | SynchronizationRequest;

function failPendingRequest(
  pending: PendingRequest,
  failure: EnvironmentConnectionFailure,
) {
  return pending.kind === "read"
    ? Deferred.fail(pending.result, failure)
    : Deferred.fail(pending.result, failure);
}
