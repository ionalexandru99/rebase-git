import {
  type EnvironmentAccessCapability,
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type ReadRepositoryHistory,
  type RepositoryHistoryClientMessage,
  type SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Deferred, Effect, Fiber, FiberSet } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import {
  RepositoryHistoryError,
  type RepositoryHistoryService,
} from "#server/domain/repository-history.contract";
import {
  EnvironmentWebSocketSessionRejected,
  type EnvironmentWebSocketWriteError,
} from "#server/features/environment-connection/websocket/environment-websocket-error.contract";
import type { EnvironmentWebSocketWriter } from "#server/features/environment-connection/websocket/environment-websocket-writer.contract";
import type { RepositoryHistorySession } from "#server/features/environment-connection/websocket/repository-history-session.contract";

const maximumConcurrentHistoryRequests = 2;
const maximumRetiredHistorySynchronizations = 64;
const historyBatchAcknowledgementTimeoutMilliseconds = 30_000;

type HistoryWriter = Pick<EnvironmentWebSocketWriter, "send" | "sendJson">;

export function acquireRepositoryHistorySession(
  history: RepositoryHistoryService | undefined,
  writer: HistoryWriter,
  access: ReadonlySet<EnvironmentAccessCapability>,
) {
  return Effect.gen(function* () {
    const requests = new Map<string, ActiveHistoryRequest>();
    const retiredSynchronizations = new Map<string, number>();
    let logicalMessageId = 0;
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        requests.clear();
        retiredSynchronizations.clear();
      }),
    );
    const fibers = yield* FiberSet.make<void>();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }),
    );

    function releaseRequest(requestId: string, request: ActiveHistoryRequest) {
      if (requests.get(requestId) !== request) return;
      requests.delete(requestId);
      if (request.kind !== "sync" || request.lastSentSequence < 0) return;
      retiredSynchronizations.set(requestId, request.lastSentSequence);
      if (retiredSynchronizations.size <= maximumRetiredHistorySynchronizations)
        return;
      const oldestRequestId = retiredSynchronizations.keys().next().value;
      if (oldestRequestId !== undefined)
        retiredSynchronizations.delete(oldestRequestId);
    }

    function readPage(
      message: ReadRepositoryHistory,
      service: RepositoryHistoryService,
    ) {
      return startRequest(
        message.requestId,
        { kind: "page" },
        service.read(message).pipe(
          Effect.flatMap((page) =>
            writer.sendJson({
              logicalMessageId: ++logicalMessageId,
              payload: encodeRepositoryHistoryPage(page),
              requestId: message.requestId,
            }),
          ),
        ),
      );
    }

    function synchronize(
      message: SynchronizeRepositoryHistory,
      service: RepositoryHistoryService,
    ) {
      const request: ActiveHistorySynchronization = {
        kind: "sync",
        lastSentSequence: -1,
      };
      return startRequest(
        message.requestId,
        request,
        service
          .synchronize(message, (batch) =>
            sendHistoryBatch(
              writer,
              request,
              batch.sequence,
              ++logicalMessageId,
              message.requestId,
              encodeRepositoryHistoryBatch(batch),
            ).pipe(Effect.mapError(historyBatchError)),
          )
          .pipe(
            Effect.flatMap((commitCount) =>
              writer.send({
                _tag: "RepositoryHistorySynchronized",
                commitCount,
                requestId: message.requestId,
              }),
            ),
          ),
      );
    }

    function startRequest(
      requestId: string,
      request: ActiveHistoryRequest,
      operation: Effect.Effect<
        void,
        | EnvironmentStorageError
        | RepositoryHistoryError
        | EnvironmentWebSocketWriteError
      >,
    ) {
      return Effect.gen(function* () {
        requests.set(requestId, request);
        request.fiber = yield* FiberSet.run(
          fibers,
          operation.pipe(
            Effect.catch((error) =>
              writer.send({
                _tag: "RepositoryHistoryFailed",
                failure:
                  error._tag === "RepositoryHistoryError"
                    ? error.failure
                    : { _tag: "GitFailed", reason: "Failed" },
                requestId,
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => releaseRequest(requestId, request)),
            ),
            Effect.catchTag(
              "EnvironmentWebSocketWriteError",
              () => Effect.void,
            ),
          ),
        );
      });
    }

    function acknowledge(requestId: string, sequence: number) {
      const request = requests.get(requestId);
      if (request?.kind === "sync") {
        const acknowledgement = request.acknowledgement;
        if (acknowledgement?.sequence === sequence) {
          delete request.acknowledgement;
          return Deferred.succeed(acknowledgement.deferred, undefined).pipe(
            Effect.asVoid,
          );
        }
        return sequence <= request.lastSentSequence
          ? Effect.void
          : rejectMessage();
      }
      const lastSentSequence = retiredSynchronizations.get(requestId);
      return lastSentSequence !== undefined && sequence <= lastSentSequence
        ? Effect.void
        : rejectMessage();
    }

    function cancel(requestId: string) {
      return Effect.gen(function* () {
        const request = requests.get(requestId);
        if (request === undefined) return;
        releaseRequest(requestId, request);
        if (request.fiber !== undefined) {
          yield* FiberSet.run(fibers, Fiber.interrupt(request.fiber));
        }
      });
    }

    function handle(message: RepositoryHistoryClientMessage) {
      return Effect.suspend(
        (): ReturnType<RepositoryHistorySession["handle"]> => {
          if (closed) return Effect.void;
          switch (message._tag) {
            case "AcknowledgeRepositoryHistoryBatch":
              return acknowledge(message.requestId, message.sequence);
            case "CancelRepositoryHistory":
              return cancel(message.requestId);
            case "ReadRepositoryHistory":
            case "SynchronizeRepositoryHistory":
              if (history === undefined || requests.has(message.requestId))
                return rejectMessage();
              if (!access.has("repository.read")) {
                return writer.send({
                  _tag: "RepositoryHistoryFailed",
                  failure: { _tag: "AuthorizationDenied" },
                  requestId: message.requestId,
                });
              }
              if (
                message._tag === "ReadRepositoryHistory" &&
                requests.size >= maximumConcurrentHistoryRequests
              ) {
                return failRequest(
                  message.requestId,
                  "Too many concurrent repository history requests",
                );
              }
              if (
                message._tag === "SynchronizeRepositoryHistory" &&
                [...requests.values()].some(
                  (request) => request.kind === "sync",
                )
              ) {
                return failRequest(
                  message.requestId,
                  "A repository history synchronization is already running",
                );
              }
              return message._tag === "ReadRepositoryHistory"
                ? readPage(message, history)
                : synchronize(message, history);
          }
        },
      );
    }

    function failRequest(requestId: string, detail: string) {
      return writer.send({
        _tag: "RepositoryHistoryFailed",
        failure: { _tag: "GitFailed", detail, reason: "Failed" },
        requestId,
      });
    }

    return { handle } satisfies RepositoryHistorySession;
  });
}

function rejectMessage() {
  return Effect.fail(
    new EnvironmentWebSocketSessionRejected({
      result: { _tag: "HelloRejected", failure: { _tag: "InvalidMessage" } },
    }),
  );
}

function historyBatchError(cause: unknown) {
  return new RepositoryHistoryError({
    cause,
    failure: {
      _tag: "GitFailed",
      detail: "History batch acknowledgement failed",
      reason: "Failed",
    },
  });
}

function sendHistoryBatch(
  writer: HistoryWriter,
  request: ActiveHistorySynchronization,
  sequence: number,
  logicalMessageId: number,
  requestId: string,
  payload: Uint8Array,
) {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<void>();
    request.lastSentSequence = sequence;
    request.acknowledgement = { deferred, sequence };
    yield* writer.sendJson({ logicalMessageId, payload, requestId });
    yield* Deferred.await(deferred).pipe(
      Effect.timeout(historyBatchAcknowledgementTimeoutMilliseconds),
    );
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (request.acknowledgement?.sequence === sequence) {
          delete request.acknowledgement;
        }
      }),
    ),
  );
}

interface ActiveHistoryPageRequest {
  fiber?: Fiber.Fiber<void>;
  readonly kind: "page";
}

interface ActiveHistorySynchronization {
  acknowledgement?: {
    readonly deferred: Deferred.Deferred<void>;
    readonly sequence: number;
  };
  fiber?: Fiber.Fiber<void>;
  readonly kind: "sync";
  lastSentSequence: number;
}

type ActiveHistoryRequest =
  | ActiveHistoryPageRequest
  | ActiveHistorySynchronization;
