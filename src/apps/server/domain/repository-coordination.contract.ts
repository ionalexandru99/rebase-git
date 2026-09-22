import { Context, Data, type Effect } from "effect";

export type RepositoryResourceScope = "worktree" | "refs" | "worktree-and-refs";

export class RepositoryCoordinationError extends Data.TaggedError(
  "RepositoryCoordinationError",
)<{ readonly detail: string }> {}

export interface RepositoryCoordinationService {
  readonly run: <A, E, R>(
    directory: string,
    scope: RepositoryResourceScope,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryCoordinationError, R>;
}

export class RepositoryCoordination extends Context.Service<
  RepositoryCoordination,
  RepositoryCoordinationService
>()("RepositoryCoordination") {}
