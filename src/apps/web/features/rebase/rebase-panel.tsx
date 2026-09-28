import {
  IconCheck,
  IconCircle,
  IconCircleFilled,
  IconMinus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
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
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";

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
  if (running && operation !== undefined)
    return (
      <RebaseProgress scope={scope} operation={operation} history={history} />
    );
  if (target === undefined || head === undefined) return null;
  return (
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
  );
}

function RebaseProgress({
  scope,
  operation,
  history,
}: {
  readonly scope: RepositoryScope;
  readonly operation: RepositoryOperation;
  readonly history: PlanHistory;
}) {
  const steps = [...(operation.steps ?? [])].reverse();
  const [subjects, setSubjects] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const key = steps.map((step) => step.commit).join();
  useEffect(() => {
    let live = true;
    const oids = key.split(",").filter(Boolean);
    void history?.ask({ _tag: "Commits", oids }).then((commits) => {
      if (live)
        setSubjects(new Map(commits.map(({ oid, subject }) => [oid, subject])));
    });
    return () => {
      live = false;
    };
  }, [history, key]);
  const current = steps.findIndex((step) => step.done);
  return (
    <section
      aria-label="Interactive rebase"
      className="flex h-full min-h-0 flex-col bg-background text-[.85rem]"
    >
      <OperationHeader scope={scope} />
      <ol aria-label="Plan" className="min-h-0 flex-1 overflow-auto py-1">
        {steps.map((step, index) => {
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
                (state === "pending" || state === "dropped") && "opacity-50",
                folds(step.action) && "pl-8",
              )}
            >
              <StepIcon state={state} />
              <span
                className={cn(
                  "w-12 shrink-0 font-mono text-[11px]",
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
                {subjects.get(step.commit) ?? step.commit.slice(0, 8)}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {step.commit.slice(0, 8)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
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
