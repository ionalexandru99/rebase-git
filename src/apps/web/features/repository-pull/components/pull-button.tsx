import { IconArrowBarToDown } from "@tabler/icons-react";
import { ToolbarButton } from "#web/components/ui/toolbar-button";
import { useOperationCommandState } from "#web/features/operation-recovery/hooks/use-operation-status";
import { canPull } from "#web/features/repository-pull/can-pull";
import type { Pull } from "#web/features/repository-pull/use-pull";

export function PullButton({
  pull,
  activeBranch,
  incoming,
}: {
  readonly pull: Pull;
  readonly activeBranch: string | undefined;
  readonly incoming: number;
}) {
  const recoveryBusy = useOperationCommandState() === "busy";
  if (!pull.available) return null;
  const { pulling } = pull;
  const enabled = canPull({
    canRun: pull.canRun,
    activeBranch,
    recoveryBusy,
    pulling,
    freshnessReady: pull.freshnessReady,
  });
  return (
    <ToolbarButton
      aria-label={
        pulling
          ? "Pulling"
          : incoming > 0
            ? `Pull ${incoming} incoming ${incoming === 1 ? "commit" : "commits"}`
            : "Pull"
      }
      disabled={!enabled}
      onClick={() => {
        if (activeBranch !== undefined) void pull.pull(activeBranch);
      }}
    >
      <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
      {pulling ? "Pulling" : "Pull"}
      {pulling || incoming === 0 ? null : (
        <span
          aria-hidden="true"
          className="rounded-full bg-primary/15 px-1.5 text-[.75rem] leading-[1.15rem] text-primary tabular-nums"
        >
          {incoming}
        </span>
      )}
    </ToolbarButton>
  );
}
