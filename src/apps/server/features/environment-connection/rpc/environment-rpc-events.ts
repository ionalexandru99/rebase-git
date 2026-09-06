import type {
  EnvironmentChanged,
  RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import { Effect, Queue, Stream } from "effect";
import type { EnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-session.contract";

export function acquireEnvironmentEvents(session: EnvironmentRpcSession) {
  return Effect.gen(function* () {
    const limits = session.state.discovery.limits;
    const queue = yield* Queue.sliding<typeof EnvironmentChanged.Type>(
      limits.maxQueuedEvents,
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        session.state.events.subscribe((sequence, repositoryIds) => {
          const message: typeof EnvironmentChanged.Type = {
            _tag: "EnvironmentChanged",
            sequence,
            ...(repositoryIds === undefined ? {} : { repositoryIds }),
          };
          Queue.offerUnsafe(
            queue,
            boundedChange(
              message,
              limits.maxQueuedEventBytes / limits.maxQueuedEvents,
            ),
          );
        }),
      ),
      (release) => Effect.sync(release),
    );
    let watching = false;
    return () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const negotiated =
            yield* session.requireCapability("environment-events");
          yield* Effect.acquireRelease(
            Effect.suspend(() =>
              watching
                ? Effect.fail<RepositoryHistoryOperationFailure>({
                    _tag: "GitFailed",
                    reason: "Failed",
                  })
                : Effect.sync(() => {
                    watching = true;
                  }),
            ),
            () =>
              Effect.sync(() => {
                watching = false;
              }),
          );
          const identified = negotiated.capabilities.some(
            ({ name }) => name === "repository-ref-events",
          );
          return Stream.fromQueue(queue).pipe(
            Stream.map((message) =>
              identified
                ? boundedChange(
                    message,
                    negotiated.limits.maxWebSocketResponseBytes - 512,
                  )
                : {
                    _tag: "EnvironmentChanged" as const,
                    sequence: message.sequence,
                  },
            ),
            Stream.rechunk(1),
          );
        }),
      );
  });
}

function boundedChange(
  message: typeof EnvironmentChanged.Type,
  limit: number,
): typeof EnvironmentChanged.Type {
  return Buffer.byteLength(JSON.stringify(message)) <= limit
    ? message
    : { _tag: "EnvironmentChanged", sequence: message.sequence };
}
