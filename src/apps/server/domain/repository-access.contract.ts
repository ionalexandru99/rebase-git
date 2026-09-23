import type {
  RepositoryCatalogEntry,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";

export type RepositoryAccessFailure =
  | {
      readonly _tag: "CatalogUnavailable";
      readonly cause: EnvironmentStorageError;
    }
  | { readonly _tag: "RepositoryMissing"; readonly repositoryId: string }
  | {
      readonly _tag: "WorktreesUnreadable";
      readonly cause: RepositoryGitError;
    }
  | { readonly _tag: "WorktreeMissing"; readonly worktreePath: string };

export class RepositoryAccessError extends Data.TaggedError(
  "RepositoryAccessError",
)<{
  readonly detail: string;
  readonly failure: RepositoryAccessFailure;
}> {}

export interface RepositoryAccessService {
  readonly repository: (
    repositoryId: string,
  ) => Effect.Effect<
    RepositoryCatalogEntry,
    RepositoryAccessError | EnvironmentStorageError
  >;
  readonly worktrees: (
    repositoryPath: string,
  ) => Effect.Effect<readonly RepositoryWorktree[], RepositoryAccessError>;
  readonly requireWorktree: (scope: {
    readonly repositoryId: string;
    readonly worktreePath: string;
  }) => Effect.Effect<void, RepositoryAccessError>;
}

export class RepositoryAccess extends Context.Service<
  RepositoryAccess,
  RepositoryAccessService
>()("RepositoryAccess") {}
