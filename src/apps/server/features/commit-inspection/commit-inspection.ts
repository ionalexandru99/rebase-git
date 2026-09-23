import type { InspectCommit, InspectCommitDiff } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import {
  inspectCommit,
  inspectCommitDiff,
} from "#server/features/commit-inspection/git/inspect-commit";
import { inspectionError } from "#server/features/commit-inspection/git/inspection-error";

export function createCommitInspectionService(
  access: RepositoryAccessService,
  git: GitCommandRunner,
) {
  return {
    inspect: (command: InspectCommit) =>
      access.worktree(command).pipe(
        Effect.mapError((error) => inspectionError("Missing", error.detail)),
        Effect.andThen(() => inspectCommit(git, command)),
        Effect.mapError((error) =>
          error._tag === "RepositoryGitError"
            ? inspectionError("GitFailed", error.detail)
            : error,
        ),
      ),
    inspectDiff: (command: InspectCommitDiff) =>
      access.worktree(command).pipe(
        Effect.mapError((error) => inspectionError("Missing", error.detail)),
        Effect.andThen(() => inspectCommitDiff(git, command)),
        Effect.mapError((error) =>
          error._tag === "RepositoryGitError"
            ? inspectionError("GitFailed", error.detail)
            : error,
        ),
      ),
  };
}
