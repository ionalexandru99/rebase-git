import type { OperationAction, OperationScope } from "@rebase/contracts";
import { IconCircleFilled } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "#web/components/ui/button";
import { OperationActionsMenu } from "#web/features/operation-recovery/components/operation-actions-menu";
import { OperationConfirmation } from "#web/features/operation-recovery/components/operation-confirmation";
import {
  showsOperationHeader,
  useOperationRecovery,
} from "#web/features/operation-recovery/hooks/use-operation-recovery";
import {
  operationHeading,
  operationLabel,
} from "#web/features/operation-recovery/operation-heading";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export function OperationHeader({ scope }: { readonly scope: OperationScope }) {
  const repository = useRepositoryScope();
  const matches =
    repository?.repositoryId === scope.repositoryId &&
    repository.worktreePath === scope.worktreePath;
  const recovery = useOperationRecovery(matches ? repository : undefined);
  const [confirmation, setConfirmation] = useState<{
    readonly action: OperationAction;
    readonly revision: string;
  } | null>(null);
  const { state } = recovery;
  const operation = state.operation;
  if (operation === null || !showsOperationHeader(state)) return null;
  const label = operationLabel(state);
  const unavailable =
    !state.connected || state.checking || state.busy || !recovery.writable;
  const ready = operation.actions.find(
    (action) => action.action === "continue",
  );
  const pending =
    confirmation !== null && confirmation.revision === operation.revision
      ? confirmation
      : null;
  const meta = [operation.branch, operation.commit?.slice(0, 8)]
    .filter((part) => part)
    .join(" · ");
  return (
    <section
      aria-label="Operation"
      className="shrink-0 border-border border-b bg-muted"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-1.5">
        <IconCircleFilled
          aria-hidden="true"
          className="size-2 shrink-0 text-status-connecting"
        />
        <h2
          className="text-xs font-semibold"
          aria-live="polite"
          aria-atomic="true"
        >
          {operationHeading(state)}
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {meta}
        </span>
        {state.error !== null || operation.lock ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!state.connected || state.busy}
            onClick={recovery.refresh}
          >
            Check again
          </Button>
        ) : null}
        {ready ? (
          <Button
            size="xs"
            disabled={unavailable || !ready.enabled}
            onClick={() => recovery.execute("continue", operation.revision)}
          >
            Continue {label.toLowerCase()}
          </Button>
        ) : null}
        <OperationActionsMenu
          operation={operation}
          disabled={unavailable}
          choose={(action) =>
            setConfirmation({ action, revision: operation.revision })
          }
        />
      </div>
      {state.error !== null ? (
        <p
          role="alert"
          className="px-3 pb-2 whitespace-pre-wrap break-words text-xs text-destructive"
        >
          {state.error}
        </p>
      ) : null}
      {pending ? (
        <OperationConfirmation
          action={pending.action}
          operation={operation}
          label={label}
          disabled={unavailable}
          cancel={() => setConfirmation(null)}
          confirm={() => {
            recovery.execute(pending.action, pending.revision);
            setConfirmation(null);
          }}
        />
      ) : null}
    </section>
  );
}
