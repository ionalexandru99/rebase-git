import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import type {
  RepositoryChangePublisher,
  RepositoryRefsService,
} from "#server/domain/repository-refs.contract";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs";
import { repositoryRefsFailure } from "#server/features/repository-refs/git/repository-refs-failures";

export function createRepositoryRefsService(dependencies: {
  readonly catalog: RepositoryCatalog;
  readonly changes: RepositoryChangePublisher;
  readonly git: GitCommandRunner;
}): RepositoryRefsService {
  const { catalog, changes, git } = dependencies;
  return {
    checkout: (command) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(
          catalog,
          command.repositoryId,
        );
        return yield* checkoutRepositoryRef(git, repository.path, command);
      }),
    read: (repositoryId) =>
      Effect.gen(function* () {
        const repository = yield* requireRepository(catalog, repositoryId);
        yield* changes.watch(repository.path);
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
