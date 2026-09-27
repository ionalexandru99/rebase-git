import { writeFile } from "node:fs/promises";
import { Effect } from "effect";
import {
  type ChooseConflict,
  RepositoryConflictsApi,
  type StageConflict,
  type WholeFileChoice,
  type WriteConflict,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import { safeChangePath } from "#server/features/repository-changes/git/change-files.ts";
import {
  conflictFailed,
  requireConflict,
} from "#server/features/repository-conflicts/git/conflict-files.ts";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document.ts";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflict-list.ts";
import { previewByteLimit } from "#server/repository/comparison/read-blobs.ts";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

const specialModes = new Set(["120000", "160000"]);

function writeConflict(git: GitCommandRunner, input: WriteConflict) {
  return Effect.gen(function* () {
    const snapshot = yield* requireConflict(
      git,
      input.worktreePath,
      input.path,
      input.revision,
    );
    if (Buffer.byteLength(input.content) > previewByteLimit)
      return yield* Effect.fail(
        conflictFailed("TooLarge", "This file is too large to save here."),
      );
    if (specialModes.has(snapshot.worktree.mode))
      return yield* Effect.fail(
        conflictFailed(
          "Unsupported",
          "Links and submodules can only be resolved as a whole file.",
        ),
      );
    const target = yield* safeChangePath(input.worktreePath, input.path);
    yield* changeIo(() => writeFile(target, input.content));
    return yield* readConflictDocument(git, input);
  });
}

function chooseWholeFile(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  input: ChooseConflict,
) {
  return Effect.gen(function* () {
    const snapshot = yield* requireConflict(
      git,
      input.worktreePath,
      input.path,
      input.revision,
    );
    if (!snapshot.file.choices.includes(input.choice))
      return yield* Effect.fail(
        conflictFailed(
          "Unsupported",
          "This choice is not available for this conflict.",
        ),
      );
    for (const args of choiceCommands(input.choice, input.path))
      yield* runRepositoryGit(git, input.worktreePath, args);
    return yield* readConflictList(git, coordination, input.worktreePath);
  });
}

function stageConflict(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  input: StageConflict,
) {
  return Effect.gen(function* () {
    const snapshot = yield* requireConflict(
      git,
      input.worktreePath,
      input.path,
      input.revision,
    );
    const open = snapshot.file.openRegions;
    if (open > 0 && !input.allowMarkers)
      return yield* Effect.fail(
        conflictFailed(
          "Markers",
          `${open} conflict ${open === 1 ? "block remains" : "blocks remain"} in this file.`,
        ),
      );
    yield* runRepositoryGit(git, input.worktreePath, ["add", "--", input.path]);
    return yield* readConflictList(git, coordination, input.worktreePath);
  });
}

function choiceCommands(choice: WholeFileChoice, path: string) {
  switch (choice) {
    case "current":
      return [
        ["checkout", "--ours", "--", path],
        ["add", "--", path],
      ];
    case "incoming":
      return [
        ["checkout", "--theirs", "--", path],
        ["add", "--", path],
      ];
    case "delete":
      return [["rm", "--quiet", "--", path]];
  }
}

const resolve: RepositoryWritePolicy = {
  name: "resolve",
  locks: { worktree: "wait" },
  duringOperation: {
    allowWhen: (operation) =>
      operation.phase === "conflicts" || operation.phase === "ready",
  },
};

export function repositoryConflictsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const { coordination } = dependencies;
  const api = RepositoryConflictsApi;
  return {
    routes: [
      query(api.list, (input, git) =>
        readConflictList(git, coordination, input.worktreePath),
      ),
      query(api.document, (input, git) => readConflictDocument(git, input)),
      command(api.write, resolve, (input, git) => writeConflict(git, input)),
      command(api.choose, resolve, (input, git) =>
        chooseWholeFile(git, coordination, input),
      ),
      command(api.stage, resolve, (input, git) =>
        stageConflict(git, coordination, input),
      ),
    ],
  };
}
