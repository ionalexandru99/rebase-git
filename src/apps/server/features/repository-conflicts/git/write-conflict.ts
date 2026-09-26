import { randomUUID } from "node:crypto";
import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { WriteConflict } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import { conflictFailed } from "#server/features/repository-conflicts/git/conflict-failures";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document";
import { requireConflict } from "#server/features/repository-conflicts/git/read-conflict-files";

const specialModes = new Set(["120000", "160000"]);

export function writeConflict(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
  input: WriteConflict,
) {
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
    yield* changeIo(() => replaceFile(target, input.content));
    return yield* readConflictDocument(git, coordination, input);
  });
}

async function replaceFile(target: string, content: string) {
  const mode = await stat(target).then(
    (info) => info.mode & 0o7777,
    () => null,
  );
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { flag: "wx" });
    if (mode !== null) await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
