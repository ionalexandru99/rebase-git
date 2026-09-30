import {
  IconChevronDown,
  IconChevronUp,
  IconCircleFilled,
} from "@tabler/icons-react";
import { useState } from "react";
import type { OperationAction } from "#contracts/repository-operations/repository-operations.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { OperationControls } from "#web/features/operation-recovery/components/operation-controls.tsx";
import {
  type OperationRecoveryState,
  showsOperationHeader,
  useOperationRecovery,
} from "#web/features/operation-recovery/hooks/use-operation-recovery.ts";
import { operationHeading } from "#web/features/operation-recovery/operation-messages.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

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
  const operation = state.operation;
  if (
    operation?.kind === "idle" &&
    state.completed === null &&
    state.error === null
  )
    return null;
  if (operation === null && state.error === null) return null;
  const active = operation !== null && operation.kind !== "idle";
  const conflicts = operation?.unresolvedPaths.length ?? 0;
  const ready = operation?.actions.find(
    (action) => action.action === "continue",
  );
  const openChanges = () => {
    setCollapsed(true);
    review();
  };
  return (
    <section
      aria-label="Git operation"
      className="max-h-[calc(100dvh-5rem)] overflow-y-auto"
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
          {operationHeading(state)}
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
          {!state.completed && (
            <>
              {ready?.reason && (
                <p className="px-3 pb-3 text-xs text-muted-foreground">
                  {ready.reason}
                </p>
              )}
              {!writable && active && state.connected && (
                <p className="px-3 pb-3 text-xs text-muted-foreground">
                  Repository write access is required to recover this operation.
                </p>
              )}
              <OperationControls
                state={state}
                writable={writable}
                execute={execute}
                refresh={refresh}
                className="border-t border-border px-3 py-2"
              >
                {conflicts > 0 ? (
                  <Button
                    size="xs"
                    disabled={!state.connected || state.busy}
                    onClick={openChanges}
                  >
                    Review conflicts
                  </Button>
                ) : null}
                {operation?.phase === "edit" && (
                  <Button size="xs" variant="ghost" onClick={openChanges}>
                    Review commit
                  </Button>
                )}
                <span className="flex-1" />
              </OperationControls>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function OperationRecoveryNotice({
  repositoryName,
}: {
  readonly repositoryName: string;
}) {
  const scope = useRepositoryScope();
  const recovery = useOperationRecovery(scope, { polling: true });
  const panel = useWorkspacePanel();
  if (scope === undefined) return null;
  const headerVisible =
    panel.state.open &&
    (panel.state.active === "changes" || panel.state.active === "rebase");
  if (headerVisible && showsOperationHeader(recovery.state)) return null;
  return (
    <PersistentNotification>
      <OperationRecoveryToast
        {...recovery}
        repositoryName={repositoryName}
        review={() => panel.execute({ type: "open", kind: "changes" })}
      />
    </PersistentNotification>
  );
}
