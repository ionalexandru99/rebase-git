import type { RepositoryOperation } from "@rebase/contracts";
import { Context, Data, type Effect } from "effect";

export type RepositoryWrite =
  | "branch"
  | "checkout"
  | "fetch"
  | "pull"
  | "push"
  | "stage"
  | "unstage"
  | "discard"
  | "commit"
  | "amend"
  | "recover";

export class RepositoryCoordinationError extends Data.TaggedError(
  "RepositoryCoordinationError",
)<{
  readonly reason: "Unavailable" | "Busy" | "Incompatible";
  readonly detail: string;
}> {}

export interface RepositoryCoordinationService {
  readonly run: <A, E, R>(
    directory: string,
    write: RepositoryWrite,
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
