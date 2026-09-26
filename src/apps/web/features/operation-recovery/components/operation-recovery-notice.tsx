import type {
  OperationAction,
  OperationKind,
  RepositoryOperation,
} from "@rebase/contracts";
import { useState } from "react";
import { PersistentNotification } from "#web/features/notifications/index";
import { useOperationAction } from "#web/features/operation-recovery/hooks/use-operation";
import { useOperationStatus } from "#web/features/operation-recovery/hooks/use-operation-status";
import { describeOperationFailure } from "#web/features/operation-recovery/operation-messages";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { OperationRecoveryToast } from "#web-ui/features/operation-recovery/components/operation-recovery-toast";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/index";

interface CompletedOperation {
  readonly kind: OperationKind;
  readonly aborted: boolean;
}

export function OperationRecoveryNotice({
  repositoryName,
}: {
  readonly repositoryName: string;
}) {
  const scope = useRepositoryScope();
  const status = useOperationStatus(scope);
  const action = useOperationAction();
  const panel = useWorkspacePanel();
  const [completed, setCompleted] = useState<CompletedOperation | null>(null);
  if (scope === undefined) return null;
  const operation = status.operation;
  const connected = scope.connected;

  const execute = (choice: OperationAction, revision: string) => {
    if (
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

  return (
    <PersistentNotification>
      <OperationRecoveryToast
        state={{
          operation,
          connected,
          checking: status.checking,
          busy: status.busy,
          error:
            action.error === null
              ? status.error
              : describeOperationFailure(action.error),
          completed: operation?.kind === "idle" ? completed : null,
        }}
        repositoryName={repositoryName}
        writable={scope.writable}
        execute={execute}
        refresh={() => {
          action.reset();
          status.refresh();
        }}
        dismiss={() => setCompleted(null)}
        review={() => panel.execute({ type: "open", kind: "changes" })}
      />
    </PersistentNotification>
  );
}

function allows(operation: RepositoryOperation, action: OperationAction) {
  return operation.actions.some(
    (candidate) => candidate.action === action && candidate.enabled,
  );
}
