import { RepositoryConflictsHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { query } from "#server/adapters/environment-transport/http/repository-http-routes";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflicts";

export const repositoryConflictsFeature = Effect.gen(function* () {
  const coordination = yield* RepositoryCoordination;
  const api = RepositoryConflictsHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      yield* query(api.list, (input, git) =>
        readConflictList(git, coordination, input.worktreePath),
      ),
      yield* query(api.document, (input, git) =>
        readConflictDocument(git, coordination, input),
      ),
    ],
  } satisfies EnvironmentFeature;
});
