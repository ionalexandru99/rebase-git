import type {
  RepositoryFetchSetting,
  RepositoryFreshness,
  RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import { Effect, Option, Queue, Semaphore, Stream } from "effect";
import type { EnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-session.contract";

export function repositoryFreshnessRpc(session: EnvironmentRpcSession) {
  const subscriptions = new Set<string>();
  const commands = Semaphore.makeUnsafe(32);
  const runCommand = <A>(
    command: Effect.Effect<A, RepositoryHistoryOperationFailure>,
  ) =>
    command.pipe(
      commands.withPermitsIfAvailable(1),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail<RepositoryHistoryOperationFailure>({
              _tag: "GitFailed",
              reason: "Failed",
            }),
          onSome: Effect.succeed,
        }),
      ),
    );
  const service = (write = false) =>
    session
      .requireCapability(
        "repository-history-freshness",
        write ? "repository.write" : "repository.read",
      )
      .pipe(
        Effect.flatMap(() =>
          session.state.freshness === undefined
            ? Effect.fail<RepositoryHistoryOperationFailure>({
                _tag: "GitFailed",
                reason: "Failed",
              })
            : Effect.succeed(session.state.freshness),
        ),
      );
  return {
    WatchFreshness: ({ repositoryId }: { repositoryId: string }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const freshness = yield* service();
          if (subscriptions.size >= 32 || subscriptions.has(repositoryId))
            return yield* Effect.fail<RepositoryHistoryOperationFailure>({
              _tag: "GitFailed",
              reason: "Failed",
            });
          subscriptions.add(repositoryId);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              subscriptions.delete(repositoryId);
            }),
          );
          const queue = yield* Queue.sliding<RepositoryFreshness>(1);
          yield* Effect.addFinalizer(() => Queue.shutdown(queue));
          const automaticFetch = yield* service(true).pipe(
            Effect.match({ onFailure: () => false, onSuccess: () => true }),
          );
          yield* Effect.acquireRelease(
            freshness.subscribe(
              repositoryId,
              (state) => {
                Queue.offerUnsafe(queue, state);
              },
              { automaticFetch },
            ),
            (release) => release,
          ).pipe(Effect.mapError((error) => error.failure));
          return Stream.fromQueue(queue);
        }),
      ),
    FetchHistory: ({ repositoryId }: { repositoryId: string }) =>
      service(true).pipe(
        Effect.flatMap((freshness) => freshness.fetch(repositoryId)),
        Effect.mapError(failure),
        runCommand,
      ),
    ConfigureFetch: ({
      repositoryId,
      setting,
    }: {
      repositoryId: string;
      setting: RepositoryFetchSetting;
    }) =>
      service(true).pipe(
        Effect.flatMap((freshness) =>
          freshness.configure(repositoryId, setting),
        ),
        Effect.mapError(failure),
        runCommand,
      ),
  };
}

function failure(
  error:
    | RepositoryHistoryOperationFailure
    | { readonly failure: RepositoryHistoryOperationFailure },
): RepositoryHistoryOperationFailure {
  return "failure" in error ? error.failure : error;
}
