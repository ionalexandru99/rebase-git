import type { OperationKind } from "@rebase/contracts";
import type { OperationRecoveryState } from "#web/features/operation-recovery/hooks/use-operation-recovery";

const labels: Record<OperationKind, string> = {
  idle: "Git operation",
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  am: "Patch application",
  unknown: "Unknown Git operation",
};

export function operationLabel(state: OperationRecoveryState) {
  return labels[state.completed?.kind ?? state.operation?.kind ?? "unknown"];
}

export function operationHeading(state: OperationRecoveryState) {
  const { operation } = state;
  const label = operationLabel(state);
  const progress = operation?.progress
    ? ` · ${operation.progress.current}/${operation.progress.total}`
    : "";
  const conflicts = operation?.unresolvedPaths.length ?? 0;
  const ready = operation?.actions.find(
    (action) => action.action === "continue",
  );
  if (state.completed)
    return `${label} ${state.completed.aborted ? "aborted" : "completed"}`;
  if (!state.connected) return `${label} · Connection lost`;
  if (state.busy) return `${label} · Working…`;
  if (state.checking) return "Checking Git state…";
  if (operation?.phase === "edit") return `${label} · Edit commit${progress}`;
  if (conflicts)
    return `${label} · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}${progress}`;
  return `${label}${ready?.enabled ? " ready to continue" : " paused"}${progress}`;
}
