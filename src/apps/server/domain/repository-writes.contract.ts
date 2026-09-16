import type { OperationInvalidation } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Context, type Effect } from "effect";
import type { RepositoryOperationError } from "#server/domain/repository-operations.contract";

export type RepositoryWriteIntent =
  | "checkout"
  | "fetch"
  | "stage"
  | "unstage"
  | "discard"
  | "commit"
  | "amend"
  | "recover";
export interface RepositoryWritesService {
  readonly run: <A, E, R>(
    directory: string,
    intent: RepositoryWriteIntent,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryOperationError, R>;
}
export interface RepositoryWriteInvalidation {
  readonly directory: string;
  readonly affected: OperationInvalidation;
}
export class RepositoryWrites extends Context.Service<
  RepositoryWrites,
  RepositoryWritesService
>()("RepositoryWrites") {}
