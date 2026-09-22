import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import type {
  RepositoryChangePublisher,
  RepositoryRefsService,
} from "#server/domain/repository-refs.contract";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/features/repository-access/index";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs";
import {
  repositoryRefsFailure,
  worktreeReadFailed,
} from "#server/features/repository-refs/git/repository-refs-failures";

export function createRepositoryRefsService(dependencies: {
  readonly catalog: Pick<RepositoryCatalog, "find">;
  readonly changes: RepositoryChangePublisher;
  readonly git: GitCommandRunner;
  readonly coordination: RepositoryCoordinationService;
}): RepositoryRefsService {
  const { catalog, changes, git, coordination } = dependencies;
  return {
    checkout: (command) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(
          catalog,
          command.repositoryId,
        );
        const worktrees = yield* readWorktrees(git, repository.path).pipe(
          Effect.mapError(worktreeReadFailed),
          Effect.flatMap(canonicalizeWorktrees),
        );
        if (
          !worktrees.some((worktree) => worktree.path === command.worktreePath)
        ) {
          return yield* Effect.fail(
            repositoryRefsFailure({
              _tag: "WorktreeMissing",
              worktreePath: command.worktreePath,
            }),
          );
        }
        return yield* coordination
          .run(
            command.worktreePath,
            "worktree-and-refs",
            checkoutRepositoryRef(git, repository.path, command),
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
    read: (repositoryId) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(catalog, repositoryId);
        yield* changes.watch(repository);
        return yield* readRepositoryRefs(git, repository);
      }),
  };
}

function requireRepository(
  catalog: Pick<RepositoryCatalog, "find">,
  repositoryId: string,
) {
  return catalog.find(repositoryId).pipe(
    Effect.flatMap((repository: RepositoryCatalogEntry | undefined) =>
      repository === undefined
        ? Effect.fail(
            repositoryRefsFailure({
              _tag: "RepositoryMissing",
              repositoryId,
            }),
          )
        : Effect.succeed(repository),
    ),
  );
}
