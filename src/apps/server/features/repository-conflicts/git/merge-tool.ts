import type { ConflictPath } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import {
  confirmChange,
  conflictFailed,
  runConflictGit,
} from "#server/features/repository-conflicts/git/conflict-failures";
import { requireConflict } from "#server/features/repository-conflicts/git/read-conflict-files";
import {
  readConflictList,
  readMergeTool,
} from "#server/features/repository-conflicts/git/read-conflicts";

const mergeToolDeadlineMilliseconds = 60 * 60 * 1_000;

export function openMergeTool(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
  input: ConflictPath,
) {
  return Effect.gen(function* () {
    if ((yield* readMergeTool(git, input.worktreePath)) === null)
      return yield* Effect.fail(
        conflictFailed(
          "NoMergeTool",
          "Set merge.tool in your Git configuration to use an external merge tool.",
        ),
      );
    yield* requireConflict(git, input.worktreePath, input.path);
    yield* runConflictGit(
      git,
      input.worktreePath,
      ["mergetool", "--no-prompt", "--", input.path],
      { timeoutMilliseconds: mergeToolDeadlineMilliseconds },
    );
    return yield* confirmChange(
      readConflictList(git, coordination, input.worktreePath),
    );
  });
}
