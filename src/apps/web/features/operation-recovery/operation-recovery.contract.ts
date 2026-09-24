import type {
  ExecuteOperation,
  OperationKind,
  OperationScope,
  RepositoryOperation,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";

export class OperationRecoveryError extends Data.TaggedError(
  "OperationRecoveryError",
)<{ readonly message: string }> {}

export interface RepositoryOperationsClient {
  readonly read: (
    scope: OperationScope,
  ) => Effect.Effect<RepositoryOperation, OperationRecoveryError>;
  readonly execute: (
    command: ExecuteOperation,
  ) => Effect.Effect<RepositoryOperation, OperationRecoveryError>;
}

export interface OperationRecoveryState {
  readonly operation: RepositoryOperation | null;
  readonly connected: boolean;
  readonly checking: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly completed: {
    readonly kind: OperationKind;
    readonly aborted: boolean;
  } | null;
}
