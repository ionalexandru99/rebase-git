import {
  IconCheck,
  IconCircle,
  IconCircleFilled,
  IconMinus,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import type { RebaseStep } from "#contracts/repository-operations/repository-operations.contract.ts";
import { OperationHeader } from "#web/features/operation-recovery/components/operation-controls.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { PlanEditor } from "#web/features/rebase/plan-editor.tsx";
import { actionColors } from "#web/features/rebase/plan-list.tsx";
import {
  folds,
  isRebasePlanTarget,
  type PlanHistory,
} from "#web/features/rebase/rebase-plan.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { cn } from "#web/lib/utils.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export function RebasePanel({
  history,
  onClose = () => undefined,
}: {
  readonly history?: PlanHistory;
  readonly onClose?: () => void;
}) {
  const scope = useRepositoryScope();
  const feature = usePanelFeature();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(scope, false).data;
  const running = operation?.kind === "rebase" && operation.steps !== null;
  const shown = useRef(false);
  useEffect(() => {
    if (running) shown.current = true;
    else if (shown.current && operation?.kind === "idle") {
      shown.current = false;
      onClose();
    }
  }, [running, operation?.kind, onClose]);
  const head =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const target = isRebasePlanTarget(feature?.input) ? feature.input : undefined;
  if (scope === undefined) return null;
  return (
    <section
      aria-label="Interactive rebase"
      className="flex h-full min-h-0 flex-col bg-background text-body"
    >
      <OperationHeader scope={scope} />
      {running ? (
        <RebaseProgress steps={operation.steps ?? []} />
      ) : target === undefined || head === undefined ? null : (
        <PlanEditor
          key={`${head.commit}:${target.commit}:${target.from}`}
          scope={scope}
          history={history}
          head={head.commit}
          target={target}
          blocked={
            operation !== undefined && operation.kind !== "idle"
              ? "Another operation is in progress."
              : head.branch === undefined
                ? "HEAD is detached."
                : undefined
          }
          close={onClose}
        />
      )}
    </section>
  );
}

function RebaseProgress({ steps }: { readonly steps: readonly RebaseStep[] }) {
  const newestFirst = [...steps].reverse();
  const current = newestFirst.findIndex((step) => step.done);
  return (
    <ol aria-label="Plan" className="min-h-0 flex-1 overflow-auto py-1">
      {newestFirst.map((step, index) => {
        const state =
          index === current
            ? "current"
            : step.done
              ? "done"
              : step.action === "drop"
                ? "dropped"
                : "pending";
        return (
          <li
            key={step.commit}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex h-7 items-center gap-2 px-3 whitespace-nowrap",
              state === "current" && "bg-status-connecting/10",
              (state === "pending" || state === "dropped") && "opacity-60",
              folds(step.action) && "pl-8",
            )}
          >
            <StepIcon state={state} />
            <span
              className={cn(
                "w-12 shrink-0 font-mono text-badge",
                actionColors[step.action],
              )}
            >
              {step.action}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                step.action === "drop" && "line-through",
              )}
            >
              {step.subject || step.commit.slice(0, 8)}
            </span>
            <span className="font-mono text-badge text-muted-foreground">
              {step.commit.slice(0, 8)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({
  state,
}: {
  readonly state: "current" | "done" | "dropped" | "pending";
}) {
  const className = "size-3.5 shrink-0";
  if (state === "done")
    return (
      <IconCheck
        aria-label="Done"
        className={cn(className, "text-status-available")}
      />
    );
  if (state === "current")
    return (
      <IconCircleFilled
        aria-label="Stopped here"
        className={cn(className, "text-status-connecting")}
      />
    );
  if (state === "dropped")
    return <IconMinus aria-label="Dropped" className={className} />;
  return <IconCircle aria-label="Pending" className={className} />;
}
