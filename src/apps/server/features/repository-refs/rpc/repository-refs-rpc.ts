import {
  fragmentJsonMessage,
  type RepositoryRefsFailed,
} from "@rebase/contracts";
import { Effect, Stream } from "effect";
import type { EnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-session.contract";

export function repositoryRefsRpc(session: EnvironmentRpcSession) {
  let active = 0;
  return ({
    repositoryId,
    requestId,
  }: {
    repositoryId: string;
    requestId: string;
  }) =>
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
        const refs = session.state.refs;
        yield* Effect.acquireRelease(
          Effect.suspend(() =>
            active >= 2 || refs === undefined
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
        if (refs === undefined)
          return yield* Effect.fail<RepositoryRefsFailed["failure"]>({
            _tag: "GitFailed",
            reason: "Failed",
          });
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
    );
}
