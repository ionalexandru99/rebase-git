import { RepositoryConflictsHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import {
  command,
  query,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import {
  RepositoryCoordination,
  type RepositoryWritePolicy,
} from "#server/domain/repository-coordination.contract";
import { chooseWholeFile } from "#server/features/repository-conflicts/git/choose-whole-file";
import { openMergeTool } from "#server/features/repository-conflicts/git/merge-tool";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflicts";
import { reopenConflict } from "#server/features/repository-conflicts/git/reopen-conflict";
import { stageConflict } from "#server/features/repository-conflicts/git/stage-conflict";
import { writeConflict } from "#server/features/repository-conflicts/git/write-conflict";

const resolve: RepositoryWritePolicy = {
  name: "resolve",
  locks: { worktree: "wait" },
  duringOperation: {
    allowWhen: (operation) =>
      operation.phase === "conflicts" || operation.phase === "ready",
  },
};

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
      yield* command(api.write, resolve, (input, git) =>
        writeConflict(git, coordination, input),
      ),
      yield* command(api.choose, resolve, (input, git) =>
        chooseWholeFile(git, coordination, input),
      ),
      yield* command(api.stage, resolve, (input, git) =>
        stageConflict(git, coordination, input),
      ),
      yield* command(api.reopen, resolve, (input, git) =>
        reopenConflict(git, coordination, input),
      ),
      yield* command(api.mergeTool, resolve, (input, git) =>
        openMergeTool(git, coordination, input),
      ),
    ],
  } satisfies EnvironmentFeature;
});
