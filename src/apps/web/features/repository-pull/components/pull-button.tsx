import { IconArrowBarToDown } from "@tabler/icons-react";
import { useOperationCommandState } from "#web/features/operation-recovery/index";
import { Button } from "#web-ui/components/ui/button";
import { useRepositoryPull } from "#web-ui/features/repository-pull/repository-pull-provider";

export function PullButton() {
  const pull = useRepositoryPull();
  const busy = useOperationCommandState() === "busy";
  if (pull === undefined) return null;
  const { activeBranch, incoming, pulling } = pull;
  const enabled =
    pull.allowed &&
    activeBranch !== undefined &&
    !busy &&
    !pulling &&
    pull.freshnessReady;
  return (
    <Button
      aria-label={
        pulling
          ? "Pulling"
          : incoming > 0
            ? `Pull ${incoming} incoming ${incoming === 1 ? "commit" : "commits"}`
            : "Pull"
      }
      className="h-7 gap-1.5 text-[.85rem] sm:text-[.85rem]"
      disabled={!enabled}
      onClick={() => {
        if (activeBranch !== undefined) pull.execute(activeBranch);
      }}
      size="sm"
      variant="ghost"
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
    </Button>
  );
}
