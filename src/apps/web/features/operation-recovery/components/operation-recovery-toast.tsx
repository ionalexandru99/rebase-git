import type { OperationAction, OperationKind } from "@rebase/contracts";
import {
  IconChevronDown,
  IconChevronUp,
  IconCircleFilled,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import type { OperationRecoveryState } from "#web/features/operation-recovery/operation-recovery.contract";
import { Button } from "#web-ui/components/ui/button";
import { OperationActionsMenu } from "#web-ui/features/operation-recovery/components/operation-actions-menu";
import { OperationConfirmation } from "#web-ui/features/operation-recovery/components/operation-confirmation";

const labels: Record<OperationKind, string> = {
  idle: "Git operation",
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  am: "Patch application",
  unknown: "Unknown Git operation",
};

export function OperationRecoveryToast({
  state,
  repositoryName,
  writable,
  execute,
  review,
  refresh,
  dismiss,
}: {
  readonly state: OperationRecoveryState;
  readonly repositoryName: string;
  readonly writable: boolean;
  readonly execute: (action: OperationAction, revision: string) => void;
  readonly review: () => void;
  readonly refresh: () => void;
  readonly dismiss: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: OperationAction;
    revision: string;
  } | null>(null);
  const card = useRef<HTMLElement>(null);
  const operation = state.operation;
  if (
    operation?.kind === "idle" &&
    state.completed === null &&
    state.error === null
  )
    return null;
  if (operation === null && state.error === null) return null;
  const active = operation !== null && operation.kind !== "idle";
  const label = labels[state.completed?.kind ?? operation?.kind ?? "unknown"];
  const unavailable =
    !state.connected || state.checking || state.busy || !writable;
  const progress = operation?.progress
    ? ` · ${operation.progress.current}/${operation.progress.total}`
    : "";
  const conflicts = operation?.unresolvedPaths.length ?? 0;
  const ready = operation?.actions.find(
    (action) => action.action === "continue",
  );
  const heading = state.completed
    ? `${label} ${state.completed.aborted ? "aborted" : "completed"}`
    : !state.connected
      ? `${label} · Connection lost`
      : state.busy
        ? `${label} · Working…`
        : state.checking
          ? "Checking Git state…"
          : operation?.phase === "edit"
            ? `${label} · Edit commit${progress}`
            : conflicts
              ? `${label} · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}${progress}`
              : `${label}${ready?.enabled ? " ready to continue" : " paused"}${progress}`;
  const openChanges = () => {
    setCollapsed(true);
    review();
  };
  const confirm = (action: OperationAction) => {
    if (!operation) return;
    setConfirmation({ action, revision: operation.revision });
    card.current?.focus();
  };
  const pending =
    confirmation !== null && confirmation.revision === operation?.revision;
  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-label="Git operation"
      className="pointer-events-auto max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <IconCircleFilled
          aria-hidden="true"
          className={`size-2 shrink-0 ${state.completed ? "text-status-available" : "text-status-connecting"}`}
        />
        <h2
          className="min-w-0 flex-1 text-xs font-semibold"
          aria-live="polite"
          aria-atomic="true"
        >
          {heading}
        </h2>
        {state.completed ? (
          <Button size="xs" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        ) : (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={collapsed ? "Expand operation" : "Collapse operation"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <IconChevronDown /> : <IconChevronUp />}
          </Button>
        )}
      </div>
      {!collapsed && (
        <>
          <p className="px-3 pb-2 break-all font-mono text-[10px] text-muted-foreground">
            {repositoryName}
            {operation?.branch ? ` · ${operation.branch}` : ""}
          </p>
          {state.error && (
            <p
              role="alert"
              className="px-3 pb-3 whitespace-pre-wrap break-words text-xs text-destructive"
            >
              {state.error}
            </p>
          )}
          {!state.connected && (
            <p className="px-3 pb-3 text-xs text-muted-foreground">
              Waiting to reconnect. Git state will be checked before another
              action.
            </p>
          )}
          {pending && operation ? (
            <OperationConfirmation
              action={confirmation.action}
              operation={operation}
              label={label}
              disabled={unavailable}
              cancel={() => {
                setConfirmation(null);
                card.current?.focus();
              }}
              confirm={() => {
                execute(confirmation.action, confirmation.revision);
                setConfirmation(null);
                card.current?.focus();
              }}
            />
          ) : (
            !state.completed && (
              <>
                {confirmation !== null && (
                  <p className="px-3 pb-2 text-xs text-muted-foreground">
                    Git state changed. Review the available actions.
                  </p>
                )}
                {operation?.phase === "edit" && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Amend this commit in Diffs, or continue unchanged.
                  </p>
                )}
                {ready?.reason && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    {ready.reason}
                  </p>
                )}
                {operation?.kind === "unknown" && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Git metadata could not be recognized. Recovery actions are
                    unavailable.
                  </p>
                )}
                {!writable && active && state.connected && (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Repository write access is required to recover this
                    operation.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                  {conflicts > 0 ? (
                    <Button
                      key="review"
                      size="xs"
                      disabled={!state.connected || state.busy}
                      onClick={openChanges}
                    >
                      Review conflicts
                    </Button>
                  ) : active && ready ? (
                    <Button
                      key="continue"
                      size="xs"
                      disabled={unavailable || !ready.enabled}
                      onClick={() =>
                        operation && execute("continue", operation.revision)
                      }
                    >
                      Continue {label.toLowerCase()}
                    </Button>
                  ) : null}
                  {operation?.phase === "edit" && (
                    <Button size="xs" variant="ghost" onClick={openChanges}>
                      Review commit
                    </Button>
                  )}
                  {(state.error !== null ||
                    operation?.lock ||
                    operation?.kind === "unknown") && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!state.connected || state.busy}
                      onClick={refresh}
                    >
                      Check again
                    </Button>
                  )}
                  <span className="flex-1" />
                  {active && operation && (
                    <OperationActionsMenu
                      operation={operation}
                      disabled={unavailable}
                      choose={confirm}
                    />
                  )}
                </div>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
