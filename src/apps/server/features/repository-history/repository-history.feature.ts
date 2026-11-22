import {
  RepositoryHistoryApi,
  type RepositoryHistoryUpdate,
  type SynchronizeRepositoryHistory,
} from "#contracts/repository-history/repository-history.contract.ts";
import {
  type EnvironmentFeature,
  stream,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  findHistoryRepository,
  historyWireFailure,
} from "#server/features/repository-history/git/history-failures.ts";
import {
  createHistoryLayoutCache,
  type HistoryLayoutRead,
} from "#server/features/repository-history/git/history-layout.ts";
import { readHistoryTips } from "#server/features/repository-history/git/read-history-tips.ts";
import { streamRepositoryHistory } from "#server/features/repository-history/git/stream-repository-history.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

export function repositoryHistoryFeature({
  access,
  git,
}: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
}): EnvironmentFeature {
  const layout = createHistoryLayoutCache(git);
  return {
    routes: [
      stream(RepositoryHistoryApi.synchronize, (request) =>
        synchronizeRepositoryHistory(access, git, layout, request),
      ),
    ],
  };
}

async function* synchronizeRepositoryHistory(
  access: RepositoryAccess,
  git: GitCommandRunner,
  readLayout: HistoryLayoutRead,
  request: SynchronizeRepositoryHistory,
): AsyncIterable<RepositoryHistoryUpdate> {
  try {
    const repository = await findHistoryRepository(
      access,
      request.repositoryId,
    );
    const tips = await readHistoryTips(git, repository.path, readLayout);
    yield tips;
    const commits = streamRepositoryHistory(git, repository.path, {
      roots: tips.rootOids,
      knownTips: sameOids(request.shallowOids, tips.shallowOids)
        ? request.knownTips
        : [],
      objectFormat: tips.objectFormat,
      shallowOids: tips.shallowOids,
    });
    for await (const batch of commits)
      yield { _tag: "RepositoryHistoryCommits", commits: batch };
  } catch (error) {
    throw isGitFailed(error) ? historyWireFailure(error) : error;
  }
}

function sameOids(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((oid, index) => oid === right[index])
  );
}
