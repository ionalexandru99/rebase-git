import { IconArrowDown } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import { useOperationCommandState } from "#web/features/operation-recovery/hooks/use-operation-status";
import { canFetch } from "#web/features/repository-fetch/can-fetch";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";
import { usePulling } from "#web/features/repository-pull/hooks/use-pulling";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

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
  const pulling = usePulling();
  const enabled = canFetch({
    connected: scope?.connected === true,
    writable: scope?.writable === true,
    fetching: fetch.fetching,
    recoveryBusy,
    pulling,
    freshnessReady:
      snapshot.freshness !== undefined && snapshot.freshnessError === undefined,
  });
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
