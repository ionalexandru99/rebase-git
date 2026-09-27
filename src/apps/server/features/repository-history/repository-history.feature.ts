import { type Cause, Effect, Queue, Stream } from "effect";
import type {
  RepositoryHistoryFailure,
  RepositoryHistoryRpc,
  RepositoryHistoryUpdate,
  SynchronizeRepositoryHistory,
} from "#contracts/repository-history/repository-history.contract.ts";
import type {
  EnvironmentFeature,
  EnvironmentRpcHandlersFor,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  findHistoryRepository,
  historyWireFailure,
} from "#server/features/repository-history/git/history-failures.ts";
import { readHistoryTips } from "#server/features/repository-history/git/read-history-tips.ts";
import {
  createObjectFormatCache,
  type ObjectFormatRead,
} from "#server/features/repository-history/git/read-object-format.ts";
import { streamRepositoryHistory } from "#server/features/repository-history/git/stream-repository-history.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

export function repositoryHistoryFeature(dependencies: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
}) {
  const objectFormat = createObjectFormatCache(dependencies.git);
  const synchronize = (
    request: SynchronizeRepositoryHistory,
    emit: (
      update: RepositoryHistoryUpdate,
    ) => Effect.Effect<void, RepositoryHistoryFailure>,
  ) =>
    findHistoryRepository(dependencies.access, request.repositoryId).pipe(
      Effect.flatMap((repository) =>
        synchronizeRepositoryHistory(
          dependencies.git,
          repository.path,
          request,
          objectFormat(repository.path),
          emit,
        ),
      ),
      Effect.mapError(historyWireFailure),
    );
  return {
    routes: [],
    rpc: (): Pick<
      EnvironmentRpcHandlersFor<typeof RepositoryHistoryRpc>,
      "SynchronizeHistory"
    > => ({
      SynchronizeHistory: (request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const queue = yield* Queue.bounded<
              RepositoryHistoryUpdate,
              RepositoryHistoryFailure | Cause.Done
            >(1);
            yield* Effect.addFinalizer(() => Queue.shutdown(queue));
            yield* Effect.forkScoped(
              synchronize(request, (update) =>
                Queue.offer(queue, update).pipe(Effect.asVoid),
              ).pipe(
                Effect.andThen(Queue.end(queue)),
                Effect.catchCause((cause) => Queue.failCause(queue, cause)),
              ),
            );
            return Stream.fromQueue(queue);
          }),
        ),
    }),
  } satisfies EnvironmentFeature;
}

function synchronizeRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: SynchronizeRepositoryHistory,
  readObjectFormat: ObjectFormatRead,
  emit: (
    update: RepositoryHistoryUpdate,
  ) => Effect.Effect<void, RepositoryHistoryFailure>,
) {
  return Effect.gen(function* () {
    const tips = yield* readHistoryTips(git, repositoryPath, readObjectFormat);
    yield* emit(tips);
    yield* streamRepositoryHistory(
      git,
      repositoryPath,
      {
        roots: tips.rootOids,
        knownTips: sameOids(request.shallowOids, tips.shallowOids)
          ? request.knownTips
          : [],
        objectFormat: tips.objectFormat,
        shallowOids: tips.shallowOids,
      },
      (commits) => emit({ _tag: "RepositoryHistoryCommits", commits }),
    );
  });
}

function sameOids(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((oid, index) => oid === right[index])
  );
}
