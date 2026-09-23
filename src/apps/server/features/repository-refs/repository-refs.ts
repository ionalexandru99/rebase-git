import type { CheckoutRepositoryRef } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs";
import {
  repositoryAccessFailed,
  repositoryRefsFailure,
} from "#server/features/repository-refs/git/repository-refs-failures";
import type { RepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";

export type RepositoryRefsService = ReturnType<
  typeof createRepositoryRefsService
>;

export function createRepositoryRefsService(dependencies: {
  readonly access: RepositoryAccessService;
  readonly changes: RepositoryChangePublisher;
  readonly git: GitCommandRunner;
  readonly coordination: RepositoryCoordinationService;
}) {
  const { access, changes, git, coordination } = dependencies;
  return {
    checkout: (command: CheckoutRepositoryRef) =>
      Effect.gen(function* () {
        yield* access
          .worktree(command)
          .pipe(Effect.mapError(repositoryAccessFailed));
        return yield* coordination
          .run(
            command.worktreePath,
            "worktree-and-refs",
            checkoutRepositoryRef(git, access, command),
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "RepositoryCoordinationError"
                ? repositoryRefsFailure({
                    _tag: "GitFailed",
                    reason: "Failed",
                    detail: error.detail,
                  })
                : error,
            ),
          );
      }),
    read: (repositoryId: string) =>
      Effect.gen(function* () {
        const repository = yield* access
          .repository(repositoryId)
          .pipe(Effect.mapError(repositoryAccessFailed));
        yield* changes.watch(repository);
        return yield* readRepositoryRefs(git, repository);
      }),
  };
}
