import {
  fragmentJsonMessage,
  type RepositoryRefs,
  type RepositoryRefsFailed,
  type RepositoryRefsRpc,
  type RepositoryRejected,
  repositoryRejected,
} from "@rebase/contracts";
import { Effect, Stream } from "effect";
import type { EnvironmentRpcHandlersFor } from "#server/adapters/environment-transport/combine-environment-features";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-negotiation";

export function repositoryRefsRpc(
  session: EnvironmentRpcSession,
  readRefs: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryRefs, RepositoryRejected>,
): EnvironmentRpcHandlersFor<typeof RepositoryRefsRpc> {
  let active = 0;
  return {
    ReadRefs: ({ repositoryId, requestId }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const negotiated =
            yield* session.requireCapability("repository-refs");
          yield* Effect.acquireRelease(
            Effect.suspend(() =>
              active >= 2
                ? Effect.fail<RepositoryRefsFailed["failure"]>(
                    repositoryRejected(
                      "Busy",
                      "Another reference read is in progress.",
                    ),
                  )
                : Effect.sync(() => {
                    active += 1;
                  }),
            ),
            () =>
              Effect.sync(() => {
                active -= 1;
              }),
          );
          const value = yield* readRefs(repositoryId);
          const fragments = yield* Effect.try({
            try: () =>
              fragmentJsonMessage(
                {
                  requestId,
                  logicalMessageId: 0,
                  payload: new TextEncoder().encode(JSON.stringify(value)),
                },
                negotiated.limits.maxWebSocketResponseBytes - 512,
              ),
            catch: (): RepositoryRefsFailed["failure"] =>
              repositoryRejected(
                "GitFailed",
                "The references are too large to send.",
              ),
          });
          return Stream.fromIterable(fragments).pipe(Stream.rechunk(1));
        }),
      ),
  };
}
