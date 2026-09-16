import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import type {
  RepositoryChangePublisher,
  RepositoryRefsService,
} from "#server/domain/repository-refs.contract";
import type { RepositoryWritesService } from "#server/domain/repository-writes.contract";
import { createRepositoryWrites } from "#server/features/repository-operations/index";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import {
  canonicalizeWorktrees,
  readRepositoryRefs,
  readWorktrees,
} from "#server/features/repository-refs/git/read-repository-refs";
import { repositoryRefsFailure } from "#server/features/repository-refs/git/repository-refs-failures";

export function createRepositoryRefsService(dependencies: {
  readonly catalog: RepositoryCatalog;
  readonly changes: RepositoryChangePublisher;
  readonly git: GitCommandRunner;
  readonly writes?: RepositoryWritesService;
}): RepositoryRefsService {
  const { catalog, changes, git } = dependencies;
  const writes = dependencies.writes ?? createRepositoryWrites(git);
  return {
    checkout: (command) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(
          catalog,
          command.repositoryId,
        );
        const worktrees = yield* readWorktrees(git, repository.path).pipe(
          Effect.flatMap(canonicalizeWorktrees),
        );
        if (!worktrees.some((tree) => tree.path === command.worktreePath))
          return yield* Effect.fail(
            repositoryRefsFailure({
              _tag: "WorktreeMissing",
              worktreePath: command.worktreePath,
            }),
          );
        return yield* writes
          .run(
            command.worktreePath,
            "checkout",
            checkoutRepositoryRef(git, repository.path, command),
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "RepositoryOperationError"
                ? repositoryRefsFailure({
                    _tag: "GitFailed",
                    reason: "Failed",
                    detail: error.failure.detail,
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

function requireRepository(catalog: RepositoryCatalog, repositoryId: string) {
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
