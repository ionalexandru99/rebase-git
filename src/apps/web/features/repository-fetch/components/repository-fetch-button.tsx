import { IconArrowDown } from "@tabler/icons-react";
import { useOperationCommandState } from "#web/features/operation-recovery/index";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/index";
import { useRepositoryPulling } from "#web/features/repository-pull/index";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { Button } from "#web-ui/components/ui/button";

export function RepositoryFetchButton({
  fetch,
  snapshot,
}: {
  readonly fetch: { readonly execute: () => void; readonly fetching: boolean };
  readonly snapshot: Pick<
    RepositoryHistorySnapshot,
    "freshness" | "freshnessError"
  >;
}) {
  const scope = useRepositoryScope();
  const recoveryBusy = useOperationCommandState() === "busy";
  const pulling = useRepositoryPulling();
  const enabled =
    scope?.connected === true &&
    scope.writable &&
    !fetch.fetching &&
    !recoveryBusy &&
    !pulling &&
    snapshot.freshness !== undefined &&
    snapshot.freshnessError === undefined;
  return (
    <Button
      className="h-7 gap-1.5 text-[.85rem] sm:text-[.85rem]"
      disabled={!enabled}
      onClick={fetch.execute}
      size="sm"
      variant="ghost"
    >
      <IconArrowDown aria-hidden="true" className="size-3.5" />
      {fetch.fetching ? "Fetching" : "Fetch"}
    </Button>
  );
}
