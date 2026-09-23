import type { RepositoryRefsRpc } from "@rebase/contracts";
import {
  fragmentJsonMessage,
  type RepositoryRefsFailed,
} from "@rebase/contracts";
import { Effect, Stream } from "effect";
import type { EnvironmentRpcHandlersFor } from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-session.contract";
import type { RepositoryRefsService } from "#server/features/repository-refs/repository-refs";

export function repositoryRefsRpc(
  session: EnvironmentRpcSession,
  refs: RepositoryRefsService,
): EnvironmentRpcHandlersFor<typeof RepositoryRefsRpc> {
  let active = 0;
  return {
    ReadRefs: ({ repositoryId, requestId }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const negotiated = yield* session
            .requireCapability("repository-refs", "repository.read")
            .pipe(
              Effect.mapError((): RepositoryRefsFailed["failure"] => ({
                _tag: "CapabilityDenied",
                capability: "repository.read",
              })),
            );
          yield* Effect.acquireRelease(
            Effect.suspend(() =>
              active >= 2
                ? Effect.fail<RepositoryRefsFailed["failure"]>({
                    _tag: "GitFailed",
                    reason: "Failed",
                  })
                : Effect.sync(() => {
                    active += 1;
                  }),
            ),
            () =>
              Effect.sync(() => {
                active -= 1;
              }),
          );
          const value = yield* refs
            .read(repositoryId)
            .pipe(
              Effect.mapError((error): RepositoryRefsFailed["failure"] =>
                error._tag === "RepositoryRefsError"
                  ? error.failure
                  : { _tag: "GitFailed", reason: "Failed" },
              ),
            );
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
            catch: (): RepositoryRefsFailed["failure"] => ({
              _tag: "GitFailed",
              reason: "OutputTooLarge",
            }),
          });
          return Stream.fromIterable(fragments).pipe(Stream.rechunk(1));
        }),
      ),
  };
}
