import type {
  ExecuteOperation,
  OperationFailure,
  OperationKind,
  OperationResult,
  OperationScope,
  RepositoryOperation,
} from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Data, type Effect } from "effect";

export class OperationRecoveryError extends Data.TaggedError(
  "OperationRecoveryError",
)<{
  readonly failure: OperationFailure;
}> {}

export interface RepositoryOperationsClient {
  readonly read: (
    scope: OperationScope,
  ) => Effect.Effect<RepositoryOperation, OperationRecoveryError>;
  readonly execute: (
    command: ExecuteOperation,
  ) => Effect.Effect<OperationResult, OperationRecoveryError>;
}

export interface OperationRecoveryState {
  readonly operation: RepositoryOperation | null;
  readonly connected: boolean;
  readonly checking: boolean;
  readonly busy: boolean;
  readonly error: OperationFailure | null;
  readonly completed: {
    readonly kind: OperationKind;
    readonly aborted: boolean;
  } | null;
}
