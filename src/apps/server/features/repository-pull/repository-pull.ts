import type { PullBranch } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { fastForwardBranch } from "#server/features/repository-pull/git/fast-forward-branch";
import {
  pullAccessFailed,
  pullBlocked,
} from "#server/features/repository-pull/git/pull-failures";

export function createRepositoryPullService(dependencies: {
  readonly access: RepositoryAccessService;
  readonly git: GitCommandRunner;
  readonly coordination: RepositoryCoordinationService;
}) {
  const { access, git, coordination } = dependencies;
  const findCheckout = (repositoryPath: string, branch: string) =>
    access.worktrees(repositoryPath).pipe(
      Effect.map(
        (worktrees) =>
          worktrees.find((worktree) => worktree.head.branch === branch)?.path,
      ),
      Effect.mapError(pullAccessFailed),
    );
  return {
    pull: ({ repositoryId, branch }: PullBranch) =>
      Effect.gen(function* () {
        const repository = yield* access
          .repository(repositoryId)
          .pipe(Effect.mapError(pullAccessFailed));
        const checkout = yield* findCheckout(repository.path, branch);
        const directory = checkout ?? repository.path;
        return yield* coordination
          .run(
            directory,
            "pull",
            findCheckout(repository.path, branch).pipe(
              Effect.flatMap((current) =>
                current === checkout
                  ? fastForwardBranch(
                      git,
                      directory,
                      branch,
                      checkout !== undefined,
                    )
                  : Effect.fail(
                      pullBlocked(`${branch} was checked out while pulling`),
                    ),
              ),
            ),
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "RepositoryCoordinationError"
                ? pullBlocked(error.detail)
                : error,
            ),
          );
      }),
  };
}
