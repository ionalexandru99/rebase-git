import { IconCircleFilled } from "@tabler/icons-react";
import { type ReactNode, useRef, useState } from "react";
import type {
  OperationAction,
  OperationScope,
  RepositoryOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { OperationActionsMenu } from "#web/features/operation-recovery/components/operation-actions-menu.tsx";
import {
  type OperationRecoveryState,
  showsOperationHeader,
  useOperationRecovery,
} from "#web/features/operation-recovery/hooks/use-operation-recovery.ts";
import {
  operationHeading,
  operationLabel,
} from "#web/features/operation-recovery/operation-messages.ts";
import { cn } from "#web/lib/utils.ts";

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
  const primary: OperationAction =
    operation?.phase === "empty" ? "skip" : "continue";
  const ready = operation?.actions.find((action) => action.action === primary);
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
        <Confirmation
          title={confirmationTitle(pending.action, operation, label)}
          action={pending.action === "abort" ? "Abort" : "Skip"}
          busy={state.busy}
          disabled={unavailable}
          onCancel={settle}
          onConfirm={() => {
            execute(pending.action, pending.revision);
            settle();
          }}
          className="border-t border-border p-3"
        />
      ) : (
        <>
          {confirmation !== null ? (
            <p className="px-3 pb-2 text-meta text-muted-foreground">
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
                onClick={() => execute(primary, operation.revision)}
              >
                {primary === "continue"
                  ? `Continue ${label.toLowerCase()}`
                  : operation.kind === "am"
                    ? "Skip patch"
                    : "Skip commit"}
              </Button>
            ) : null}
            {active ? (
              <OperationActionsMenu
                operation={operation}
                primary={primary}
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
          className="px-3 pb-2 whitespace-pre-wrap break-words text-meta text-destructive"
        >
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

function confirmationTitle(
  action: OperationAction,
  operation: RepositoryOperation,
  label: string,
) {
  if (action === "abort")
    return `Abort ${label.toLowerCase()}? Conflict-resolution edits may be lost.`;
  const subject =
    operation.commit?.slice(0, 8) ??
    (operation.kind === "am" ? "this patch" : "this commit");
  return `Skip ${subject}? Its changes will not be included.`;
}

export function OperationHeader({ scope }: { readonly scope: OperationScope }) {
  const recovery = useOperationRecovery(scope);
  const { state } = recovery;
  const operation = state.operation;
  if (operation === null || !showsOperationHeader(state)) return null;
  const meta = [operation.branch, operation.commit?.slice(0, 8)]
    .filter((part) => part)
    .join(" · ");
  return (
    <section
      aria-label="Operation"
      className="shrink-0 border-border border-b bg-muted"
    >
      <OperationControls {...recovery} className="min-h-11 px-3 py-1.5">
        <IconCircleFilled
          aria-hidden="true"
          className="size-2 shrink-0 text-status-connecting"
        />
        <h2
          className="text-meta font-semibold"
          aria-live="polite"
          aria-atomic="true"
        >
          {operationHeading(state)}
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-badge text-muted-foreground">
          {meta}
        </span>
      </OperationControls>
    </section>
  );
}
