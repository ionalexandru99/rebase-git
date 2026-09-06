import type {
  EnvironmentAccessCapability,
  RepositoryRefsClientMessage,
  RepositoryRefsFailed,
} from "@rebase/contracts";
import { Effect, Fiber, FiberSet } from "effect";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import { EnvironmentWebSocketSessionRejected } from "#server/features/environment-connection/websocket/environment-websocket-error.contract";
import type { EnvironmentWebSocketWriter } from "#server/features/environment-connection/websocket/environment-websocket-writer.contract";

export function acquireRepositoryRefsSession(
  refs: RepositoryRefsService | undefined,
  writer: Pick<EnvironmentWebSocketWriter, "send" | "sendJson">,
  access: ReadonlySet<EnvironmentAccessCapability>,
) {
  return Effect.gen(function* () {
    const requests = new Map<string, Fiber.Fiber<void>>();
    const fibers = yield* FiberSet.make<void>();
    let logicalMessageId = 0;
    const fail = (
      requestId: string,
      failure: RepositoryRefsFailed["failure"],
    ) => writer.send({ _tag: "RepositoryRefsFailed", requestId, failure });

    return (message: RepositoryRefsClientMessage) =>
      Effect.gen(function* () {
        const { requestId } = message;
        if (message._tag === "CancelRepositoryRefs") {
          const fiber = requests.get(requestId);
          if (fiber !== undefined) yield* Fiber.interrupt(fiber);
          return;
        }
        if (refs === undefined || requests.has(requestId)) {
          return yield* new EnvironmentWebSocketSessionRejected({
            result: {
              _tag: "HelloRejected",
              failure: { _tag: "InvalidMessage" },
            },
          });
        }
        if (!access.has("repository.read")) {
          return yield* fail(requestId, {
            _tag: "CapabilityDenied",
            capability: "repository.read",
          });
        }
        if (requests.size >= 2) {
          return yield* fail(requestId, {
            _tag: "GitFailed",
            reason: "Failed",
            detail: "Too many concurrent repository refs requests",
          });
        }
        const fiber = yield* FiberSet.run(
          fibers,
          refs.read(message.repositoryId).pipe(
            Effect.flatMap((value) =>
              writer.sendJson({
                logicalMessageId: ++logicalMessageId,
                requestId,
                payload: new TextEncoder().encode(JSON.stringify(value)),
              }),
            ),
            Effect.catchTag("RepositoryRefsError", (error) =>
              fail(requestId, error.failure),
            ),
            Effect.catchTag("EnvironmentStorageError", () =>
              fail(requestId, { _tag: "GitFailed", reason: "Failed" }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                requests.delete(requestId);
              }),
            ),
            Effect.catchTag(
              "EnvironmentWebSocketWriteError",
              () => Effect.void,
            ),
          ),
          { startImmediately: false },
        );
        requests.set(requestId, fiber);
      });
  });
}
