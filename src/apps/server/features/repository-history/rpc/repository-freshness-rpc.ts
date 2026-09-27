import type {
  RepositoryFetchSetting,
  RepositoryFreshness,
  RepositoryHistoryOperationFailure,
  RepositoryHistoryRpc,
} from "@rebase/contracts";
import { Effect, Option, Queue, Semaphore, Stream } from "effect";
import type { EnvironmentRpcHandlersFor } from "#server/adapters/environment-transport/environment-routes";
import type { RepositoryFreshnessService } from "#server/features/repository-history/freshness/repository-freshness";

type FreshnessHandlers = Pick<
  EnvironmentRpcHandlersFor<typeof RepositoryHistoryRpc>,
  "WatchFreshness" | "FetchHistory" | "ConfigureFetch"
>;

export function repositoryFreshnessRpc(
  freshness: RepositoryFreshnessService,
): FreshnessHandlers {
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
  return {
    WatchFreshness: ({ repositoryId }: { repositoryId: string }) =>
      Stream.unwrap(
        Effect.gen(function* () {
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
          yield* Effect.acquireRelease(
            freshness.subscribe(repositoryId, (state) => {
              Queue.offerUnsafe(queue, state);
            }),
            (release) => release,
          );
          return Stream.fromQueue(queue);
        }),
      ),
    FetchHistory: ({ repositoryId }: { repositoryId: string }) =>
      runCommand(freshness.fetch(repositoryId)),
    ConfigureFetch: ({
      repositoryId,
      setting,
    }: {
      repositoryId: string;
      setting: RepositoryFetchSetting;
    }) => runCommand(freshness.configure(repositoryId, setting)),
  };
}
