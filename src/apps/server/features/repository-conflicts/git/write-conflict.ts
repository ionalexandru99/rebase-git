import { writeFile } from "node:fs/promises";
import type { WriteConflict } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import { conflictFailed } from "#server/features/repository-conflicts/git/conflict-failures";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document";
import { requireConflict } from "#server/features/repository-conflicts/git/read-conflict-files";

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
