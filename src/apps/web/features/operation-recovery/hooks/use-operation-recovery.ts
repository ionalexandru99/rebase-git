import {
  type ExecuteOperation,
  type OperationAction,
  type OperationKind,
  type OperationScope,
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts";
import { type MutationState, useMutationState } from "@tanstack/react-query";
import { useState } from "react";
import { useOperationAction } from "#web/features/operation-recovery/hooks/use-operation";
import { useWorktreeOperation } from "#web/features/operation-recovery/hooks/use-operation-status";
import { describeOperationFailure } from "#web/features/operation-recovery/operation-messages";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import {
  type CommandFailure,
  commandKey,
} from "#web/platform/query/use-command";

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

type Execution = MutationState<RepositoryOperation, unknown, ExecuteOperation>;

const executeRoute = RepositoryOperationsHttpApi.execute;

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
  const finished = useLastExecution(matched);
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
    const command = {
      repositoryId: matched.repositoryId,
      worktreePath: matched.worktreePath,
      action: choice,
    };
    const continueFresh = async () => {
      const fresh = await status.read();
      if (!stillReady(fresh, operation.kind)) return setRetrying(false);
      action.mutate(
        { ...command, revision: fresh.revision },
        { onSettled: () => setRetrying(false) },
      );
    };
    action.mutate(
      { ...command, revision },
      {
        onError: (failure) => {
          if (choice !== "continue" || !staleRejection(failure)) return;
          setRetrying(true);
          void continueFresh();
        },
      },
    );
  };

  const state: OperationRecoveryState = {
    operation,
    connected,
    checking: status?.checking ?? true,
    busy,
    error:
      action.error === null || retrying
        ? (status?.error ?? null)
        : describeOperationFailure(action.error),
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
    writable: repository?.writable ?? false,
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

function useLastExecution(scope: OperationScope | undefined) {
  const executions = useMutationState({
    filters: {
      mutationKey: commandKey(executeRoute, scope),
      status: "success",
    },
    select: (mutation) => {
      const { data, variables, submittedAt } = mutation.state as Execution;
      return {
        submittedAt,
        idle: data?.kind === "idle",
        aborted: variables?.action === "abort",
      };
    },
  });
  const last = executions.at(-1);
  return scope !== undefined && last?.idle ? last : null;
}

function staleRejection(failure: CommandFailure<typeof executeRoute>) {
  return (
    failure._tag === "EnvironmentHttpRejected" &&
    failure.failure.reason === "Stale"
  );
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
