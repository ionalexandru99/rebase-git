import type { ConflictPath } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import {
  confirmChange,
  conflictFailed,
  runConflictGit,
} from "#server/features/repository-conflicts/git/conflict-failures";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflicts";
import {
  hasSide,
  readResolveUndoEntries,
  type StageEntry,
} from "#server/features/repository-conflicts/git/stage-entries";

export function reopenConflict(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
  input: ConflictPath,
) {
  return Effect.gen(function* () {
    const stages = (yield* readResolveUndoEntries(git, input.worktreePath, [
      input.path,
    ])).get(input.path);
    if (stages === undefined)
      return yield* Effect.fail(
        conflictFailed(
          "Unsupported",
          "Git no longer remembers this conflict, so it cannot be reopened.",
        ),
      );
    for (const args of reopenCommands(stages, input.path))
      yield* runConflictGit(git, input.worktreePath, args).pipe(
        Effect.mapError((failure) =>
          failure._tag === "ConflictFailed" && failure.reason === "GitRejected"
            ? conflictFailed("Unsupported", failure.detail)
            : failure,
        ),
      );
    return yield* confirmChange(
      readConflictList(git, coordination, input.worktreePath),
    );
  });
}

function reopenCommands(stages: readonly StageEntry[], path: string) {
  if (hasSide(stages, "current") && hasSide(stages, "incoming"))
    return [["checkout", "--merge", "--", path]];
  const unresolve = ["update-index", "--unresolve", "--", path];
  if (hasSide(stages, "current"))
    return [unresolve, ["checkout", "--ours", "--", path]];
  if (hasSide(stages, "incoming"))
    return [unresolve, ["checkout", "--theirs", "--", path]];
  return [unresolve];
}
