import { Effect, Layer } from "effect";
import {
  CommitInspectionAccess,
  type CommitInspectionService,
} from "#server/domain/commit-inspection.contract";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import {
  inspectCommit,
  inspectCommitDiff,
} from "#server/features/commit-inspection/git/inspect-commit";
import { inspectionError } from "#server/features/commit-inspection/git/inspection-error";

export function createCommitInspectionService(
  access: RepositoryAccessService,
  git: GitCommandRunner,
): CommitInspectionService {
  return {
    inspect: (command) =>
      access.worktree(command).pipe(
        Effect.mapError((error) => inspectionError("Missing", error.detail)),
        Effect.andThen(() => inspectCommit(git, command)),
        Effect.mapError((error) =>
          error._tag === "RepositoryGitError"
            ? inspectionError("GitFailed", error.detail)
            : error,
        ),
      ),
    inspectDiff: (command) =>
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

export const commitInspectionLayer = Layer.effect(
  CommitInspectionAccess,
  Effect.gen(function* () {
    return createCommitInspectionService(
      yield* RepositoryAccess,
      yield* GitCommands,
    );
  }),
);
