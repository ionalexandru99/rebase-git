import { writeFile } from "node:fs/promises";
import type {
  ChooseConflict,
  StageConflict,
  WholeFileChoice,
  WriteConflict,
} from "@rebase/contracts";
import { Effect } from "effect";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import {
  conflictFailed,
  requireConflict,
} from "#server/features/repository-conflicts/git/conflict-files";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflict-list";
import { previewByteLimit } from "#server/repository/comparison/read-blobs";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

const specialModes = new Set(["120000", "160000"]);

export function writeConflict(git: GitCommandRunner, input: WriteConflict) {
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

export function chooseWholeFile(
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

export function stageConflict(
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
