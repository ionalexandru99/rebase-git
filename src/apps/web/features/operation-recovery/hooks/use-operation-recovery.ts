import type {
  OperationAction,
  OperationKind,
  OperationScope,
  RepositoryOperation,
  RepositoryOperationsApi,
} from "@rebase/contracts";
import { useState } from "react";
import { useOperationAction } from "#web/features/operation-recovery/hooks/use-operation";
import { useWorktreeOperation } from "#web/features/operation-recovery/hooks/use-operation-status";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";
import type { Command, CommandResult } from "#web/platform/query/use-command";

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

type ExecuteRoute = typeof RepositoryOperationsApi.execute;

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
  scope: OperationScope | undefined,
  options: { readonly polling?: boolean } = {},
) {
  const repository = useRepositoryScope();
  const status = useWorktreeOperation(scope, options);
  const matched = status === null ? undefined : scope;
  const action = useOperationAction(matched);
  const finished = lastExecution(action, matched);
  const [retrying, setRetrying] = useState(false);
  const [observedKind, setObservedKind] = useState<OperationKind | null>(null);
  const [forgotten, setForgotten] = useState(0);
  const operation = status?.operation ?? null;
  if (operation !== null && operation.kind !== "idle") {
    if (operation.kind !== observedKind) setObservedKind(operation.kind);
    if (finished !== null && finished.submittedAt > forgotten)
      setForgotten(finished.submittedAt);
  }
  const connected = status !== null && (repository?.connected ?? false);
  const busy = (status?.busy ?? false) || retrying;

  const execute = (choice: OperationAction, revision: string) => {
    if (
      matched === undefined ||
      status === null ||
      busy ||
      status.checking ||
      !connected ||
      operation === null ||
      !allows(operation, choice)
    )
      return;
    const continueFresh = async () => {
      setRetrying(true);
      const fresh = await status.read();
      if (stillReady(fresh, operation.kind))
        await action.run({ action: choice, revision: fresh.revision });
      setRetrying(false);
    };
    void action.run({ action: choice, revision }).then((result) => {
      if (choice === "continue" && staleRejection(result)) void continueFresh();
    });
  };

  const state: OperationRecoveryState = {
    operation,
    connected,
    checking: status?.checking ?? true,
    busy,
    error:
      action.failure === undefined || retrying
        ? (status?.error ?? null)
        : describeFailure(action.failure),
    completed:
      operation?.kind === "idle" &&
      observedKind !== null &&
      finished !== null &&
      finished.submittedAt > forgotten
        ? { kind: observedKind, aborted: finished.aborted }
        : null,
  };
  return {
    state,
    writable: action.canRun,
    execute,
    refresh: () => {
      action.reset();
      status?.refresh();
    },
    dismiss: () => {
      if (finished !== null) setForgotten(finished.submittedAt);
    },
  };
}

function lastExecution(
  action: Command<ExecuteRoute>,
  scope: OperationScope | undefined,
) {
  const last = action.lastOk;
  return scope !== undefined && last?.value.kind === "idle"
    ? { submittedAt: last.submittedAt, aborted: last.input.action === "abort" }
    : null;
}

function staleRejection(result: CommandResult<ExecuteRoute>) {
  return result._tag === "Rejected" && result.failure.reason === "Stale";
}

function stillReady(
  operation: RepositoryOperation | null,
  kind: OperationKind,
): operation is RepositoryOperation {
  return (
    operation !== null &&
    operation.kind === kind &&
    operation.phase === "ready" &&
    operation.unresolvedPaths.length === 0
  );
}

function allows(operation: RepositoryOperation, action: OperationAction) {
  return operation.actions.some(
    (candidate) => candidate.action === action && candidate.enabled,
  );
}
