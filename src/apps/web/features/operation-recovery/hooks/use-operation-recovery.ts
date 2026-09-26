import type {
  OperationAction,
  OperationKind,
  RepositoryOperation,
} from "@rebase/contracts";
import { useState } from "react";
import { useOperationAction } from "#web/features/operation-recovery/hooks/use-operation";
import { useOperationStatus } from "#web/features/operation-recovery/hooks/use-operation-status";
import { describeOperationFailure } from "#web/features/operation-recovery/operation-messages";
import type { RepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export interface OperationRecoveryState {
  readonly operation: RepositoryOperation | null;
  readonly connected: boolean;
  readonly checking: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly completed: CompletedOperation | null;
}

interface CompletedOperation {
  readonly kind: OperationKind;
  readonly aborted: boolean;
}

const headerPhases: ReadonlySet<RepositoryOperation["phase"]> = new Set([
  "conflicts",
  "ready",
  "edit",
]);

export function showsOperationHeader(state: OperationRecoveryState) {
  return (
    state.connected &&
    state.operation !== null &&
    headerPhases.has(state.operation.phase)
  );
}

export function useOperationRecovery(
  scope: RepositoryScope | undefined,
  options: { readonly polling?: boolean } = {},
) {
  const status = useOperationStatus(scope, options);
  const action = useOperationAction(scope);
  const [completed, setCompleted] = useState<CompletedOperation | null>(null);
  const operation = status.operation;
  if (completed !== null && operation !== null && operation.kind !== "idle")
    setCompleted(null);
  const connected = scope?.connected ?? false;

  const execute = (choice: OperationAction, revision: string) => {
    if (
      scope === undefined ||
      status.busy ||
      status.checking ||
      !connected ||
      operation === null ||
      !allows(operation, choice)
    )
      return;
    setCompleted(null);
    action.mutate(
      {
        repositoryId: scope.repositoryId,
        worktreePath: scope.worktreePath,
        action: choice,
        revision,
      },
      {
        onSuccess: (next) => {
          if (next.kind === "idle")
            setCompleted({ kind: operation.kind, aborted: choice === "abort" });
        },
      },
    );
  };

  const state: OperationRecoveryState = {
    operation,
    connected,
    checking: status.checking,
    busy: status.busy,
    error:
      action.error === null
        ? status.error
        : describeOperationFailure(action.error),
    completed: operation?.kind === "idle" ? completed : null,
  };
  return {
    state,
    writable: scope?.writable ?? false,
    execute,
    refresh: () => {
      action.reset();
      status.refresh();
    },
    dismiss: () => setCompleted(null),
  };
}

function allows(operation: RepositoryOperation, action: OperationAction) {
  return operation.actions.some(
    (candidate) => candidate.action === action && candidate.enabled,
  );
}
