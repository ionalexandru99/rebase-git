import type { OperationAction } from "@rebase/contracts";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "#web/components/ui/button";
import { OperationActionsMenu } from "#web/features/operation-recovery/components/operation-actions-menu";
import { OperationConfirmation } from "#web/features/operation-recovery/components/operation-confirmation";
import type { OperationRecoveryState } from "#web/features/operation-recovery/hooks/use-operation-recovery";
import { operationLabel } from "#web/features/operation-recovery/operation-messages";
import { cn } from "#web/lib/utils";

export function OperationControls({
  state,
  writable,
  execute,
  refresh,
  className,
  children,
}: {
  readonly state: OperationRecoveryState;
  readonly writable: boolean;
  readonly execute: (action: OperationAction, revision: string) => void;
  readonly refresh: () => void;
  readonly className: string;
  readonly children?: ReactNode;
}) {
  const [confirmation, setConfirmation] = useState<{
    readonly action: OperationAction;
    readonly revision: string;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { operation } = state;
  const active = operation !== null && operation.kind !== "idle";
  const label = operationLabel(state);
  const unavailable =
    !state.connected || state.checking || state.busy || !writable;
  const ready = operation?.actions.find(
    (action) => action.action === "continue",
  );
  const pending =
    confirmation !== null && confirmation.revision === operation?.revision
      ? confirmation
      : null;
  const settle = () => {
    setConfirmation(null);
    root.current?.focus();
  };
  return (
    <div ref={root} tabIndex={-1} className="outline-none">
      {pending && operation ? (
        <OperationConfirmation
          action={pending.action}
          operation={operation}
          label={label}
          disabled={unavailable}
          cancel={settle}
          confirm={() => {
            execute(pending.action, pending.revision);
            settle();
          }}
        />
      ) : (
        <>
          {confirmation !== null ? (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              Git state changed. Review the available actions.
            </p>
          ) : null}
          <div className={cn("flex flex-wrap items-center gap-2", className)}>
            {children}
            {state.error !== null ||
            operation?.lock ||
            operation?.kind === "unknown" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!state.connected || state.busy}
                onClick={refresh}
              >
                Check again
              </Button>
            ) : null}
            {active && ready ? (
              <Button
                size="xs"
                disabled={unavailable || !ready.enabled}
                onClick={() => execute("continue", operation.revision)}
              >
                Continue {label.toLowerCase()}
              </Button>
            ) : null}
            {active ? (
              <OperationActionsMenu
                operation={operation}
                disabled={unavailable}
                choose={(action) =>
                  setConfirmation({ action, revision: operation.revision })
                }
              />
            ) : null}
          </div>
        </>
      )}
      {state.error !== null ? (
        <p
          role="alert"
          className="px-3 pb-2 whitespace-pre-wrap break-words text-xs text-destructive"
        >
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
