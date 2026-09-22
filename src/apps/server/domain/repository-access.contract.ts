import type { RepositoryWorktree } from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";

export class RepositoryAccessError extends Data.TaggedError(
  "RepositoryAccessError",
)<{
  readonly detail: string;
}> {}

export interface RepositoryAccessService {
  readonly worktree: (scope: {
    readonly repositoryId: string;
    readonly worktreePath: string;
  }) => Effect.Effect<RepositoryWorktree, RepositoryAccessError>;
}

export class RepositoryAccess extends Context.Service<
  RepositoryAccess,
  RepositoryAccessService
>()("RepositoryAccess") {}
