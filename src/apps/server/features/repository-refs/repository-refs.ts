import { type RepositoryRejected, repositoryRejected } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  accessRejection,
  type RepositoryAccessError,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs";
import type { RepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";

export type RepositoryRefsReader = ReturnType<
  typeof createRepositoryRefsReader
>;

export function createRepositoryRefsReader(dependencies: {
  readonly access: RepositoryAccessService;
  readonly changes: RepositoryChangePublisher;
  readonly git: GitCommandRunner;
}) {
  const { access, changes, git } = dependencies;
  return {
    read: (repositoryId: string) =>
      Effect.gen(function* () {
        const repository = yield* access.repository(repositoryId);
        yield* changes.watch(repository);
        return yield* readRepositoryRefs(git, repository);
      }).pipe(Effect.mapError(refsReadRejected)),
  };
}

function refsReadRejected(
  error: RepositoryAccessError | EnvironmentStorageError | RepositoryGitError,
): RepositoryRejected {
  if (error._tag === "EnvironmentStorageError")
    return repositoryRejected(
      "GitFailed",
      "The repository catalog is unavailable.",
    );
  if (error._tag === "RepositoryAccessError") return accessRejection(error);
  return repositoryRejected("GitFailed", error.detail);
}
