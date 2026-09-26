import type { StageConflict } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import {
  confirmChange,
  conflictFailed,
  runConflictGit,
} from "#server/features/repository-conflicts/git/conflict-failures";
import { requireConflict } from "#server/features/repository-conflicts/git/read-conflict-files";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflicts";

export function stageConflict(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
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
    yield* runConflictGit(git, input.worktreePath, ["add", "--", input.path]);
    return yield* confirmChange(
      readConflictList(git, coordination, input.worktreePath),
    );
  });
}
