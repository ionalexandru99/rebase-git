import { Effect } from "effect";
import type {
  ConflictDocument,
  ConflictPath,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  type ConflictSnapshot,
  conflictFailed,
  requireConflict,
  worktreeText,
} from "#server/features/repository-conflicts/git/conflict-files.ts";
import { previewByteLimit } from "#server/repository/comparison/read-blobs.ts";

const textModes = new Set(["100644", "100755"]);

export function readConflictDocument(
  git: GitCommandRunner,
  input: ConflictPath,
) {
  return Effect.gen(function* () {
    const snapshot = yield* requireConflict(
      git,
      input.worktreePath,
      input.path,
    );
    yield* requireTextOnBothSides(snapshot);
    const content = yield* documentContent(snapshot);
    return { file: snapshot.file, content } satisfies ConflictDocument;
  });
}

function requireTextOnBothSides({ stages, file }: ConflictSnapshot) {
  const sides = new Set(stages.map((stage) => stage.side));
  if (!sides.has("current") || !sides.has("incoming"))
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Only files that exist on both sides can be merged line by line.",
      ),
    );
  if (stages.some((stage) => !textModes.has(stage.mode)))
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Links and submodules can only be resolved as a whole file.",
      ),
    );
  if (file.stages.some((stage) => stage.bytes > previewByteLimit))
    return Effect.fail(
      conflictFailed("TooLarge", "This file is too large to merge here."),
    );
  if (file.stages.some((stage) => stage.binary))
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Binary files can only be resolved as a whole file.",
      ),
    );
  return Effect.void;
}

function documentContent({ worktree }: ConflictSnapshot) {
  if (worktree.identity === "missing") return Effect.succeed("");
  if (worktree.bytes > previewByteLimit)
    return Effect.fail(
      conflictFailed("TooLarge", "This file is too large to merge here."),
    );
  const text = worktreeText(worktree);
  return text === null
    ? Effect.fail(
        conflictFailed(
          "Unsupported",
          "The working file is not text. Resolve it as a whole file.",
        ),
      )
    : Effect.succeed(text);
}
