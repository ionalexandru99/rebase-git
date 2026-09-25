import type { PushBranch } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import {
  pushError,
  type RepositoryPushError,
} from "#server/features/repository-push/git/push-failures";
import { pushRemoteBranch } from "#server/features/repository-push/git/push-remote-branch";

export function createRepositoryPushService(
  access: RepositoryAccessService,
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
) {
  const coordinated = <A>(
    scope: { readonly repositoryId: string; readonly worktreePath: string },
    push: Effect.Effect<A, RepositoryPushError>,
  ) =>
    access.requireWorktree(scope).pipe(
      Effect.mapError((error) => pushError("Missing", error.detail)),
      Effect.andThen(coordination.run(scope.worktreePath, "push", push)),
      Effect.mapError((error) =>
        error._tag === "RepositoryCoordinationError"
          ? pushError(
              error.reason === "Unavailable" ? "Failed" : "Busy",
              error.detail,
            )
          : error,
      ),
    );
  return {
    push: (command: PushBranch) =>
      coordinated(command, pushRemoteBranch(git, command)),
  };
}
