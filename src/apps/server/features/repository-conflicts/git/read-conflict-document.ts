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
} from "#server/features/repository-conflicts/git/conflict-files.ts";
import { conflictExcerpts } from "#server/features/repository-conflicts/git/conflict-text.ts";

const textModes = new Set(["100644", "100755"]);
const excerptByteLimit = 1_000_000;

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
    const excerpts = yield* documentExcerpts(snapshot);
    return { file: snapshot.file, excerpts } satisfies ConflictDocument;
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
  if (file.stages.some((stage) => stage.binary))
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "Binary files can only be resolved as a whole file.",
      ),
    );
  return Effect.void;
}

function documentExcerpts({ worktree, text }: ConflictSnapshot) {
  if (worktree.identity === "missing") return Effect.succeed([]);
  if (text === null)
    return Effect.fail(
      conflictFailed(
        "Unsupported",
        "The working file is not text. Resolve it as a whole file.",
      ),
    );
  const excerpts = conflictExcerpts(text);
  const bytes = excerpts.reduce(
    (total, { text }) => total + Buffer.byteLength(text),
    0,
  );
  return bytes > excerptByteLimit
    ? Effect.fail(
        conflictFailed(
          "TooLarge",
          "These conflicts are too large to merge here. Resolve them in your editor or take a whole side.",
        ),
      )
    : Effect.succeed(excerpts);
}
