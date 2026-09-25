import type { RepositoryOperation } from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";

export type RepositoryLockAcquisition = "wait" | "ifAvailable";

export interface RepositoryWritePolicy {
  readonly name: string;
  readonly locks: {
    readonly refs?: RepositoryLockAcquisition;
    readonly worktree?: RepositoryLockAcquisition;
  };
  readonly duringOperation:
    | "proceed"
    | "block"
    | { readonly allowWhen: (operation: RepositoryOperation) => boolean };
}

export class RepositoryCoordinationError extends Data.TaggedError(
  "RepositoryCoordinationError",
)<{
  readonly reason: "Unavailable" | "Busy" | "Incompatible";
  readonly detail: string;
}> {}

export interface RepositoryCoordinationService {
  readonly run: <A, E, R>(
    directory: string,
    policy: RepositoryWritePolicy,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryCoordinationError, R>;
  readonly operation: (
    directory: string,
  ) => Effect.Effect<RepositoryOperation, RepositoryCoordinationError>;
}

export class RepositoryCoordination extends Context.Service<
  RepositoryCoordination,
  RepositoryCoordinationService
>()("RepositoryCoordination") {}
