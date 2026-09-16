import type {
  ExecuteOperation,
  OperationFailure,
  OperationResult,
  OperationScope,
  RepositoryOperation,
} from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Context, Data, type Effect } from "effect";

export class RepositoryOperationError extends Data.TaggedError(
  "RepositoryOperationError",
)<{
  readonly failure: OperationFailure;
}> {}

export interface RepositoryOperationsService {
  readonly read: (
    scope: OperationScope,
  ) => Effect.Effect<RepositoryOperation, RepositoryOperationError>;
  readonly execute: (
    command: ExecuteOperation,
  ) => Effect.Effect<OperationResult, RepositoryOperationError>;
}

export class RepositoryOperations extends Context.Service<
  RepositoryOperations,
  RepositoryOperationsService
>()("RepositoryOperations") {}
