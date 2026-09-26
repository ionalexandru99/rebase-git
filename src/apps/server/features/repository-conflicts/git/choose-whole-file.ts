import type { ChooseConflict, WholeFileChoice } from "@rebase/contracts";
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

export function chooseWholeFile(
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
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
      yield* runConflictGit(git, input.worktreePath, args);
    return yield* confirmChange(
      readConflictList(git, coordination, input.worktreePath),
    );
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
    case "worktree":
      return [["add", "--", path]];
  }
}
