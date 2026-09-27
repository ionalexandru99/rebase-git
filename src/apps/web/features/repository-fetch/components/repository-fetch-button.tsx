import { RepositoryPullHttpApi } from "@rebase/contracts";
import { IconArrowDown } from "@tabler/icons-react";
import { ToolbarButton } from "#web/components/ui/toolbar-button";
import { useOperationCommandState } from "#web/features/operation-recovery/hooks/use-operation-status";
import { canFetch } from "#web/features/repository-fetch/can-fetch";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { useCommand } from "#web/platform/query/use-command";

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
  const pulling = useCommand(RepositoryPullHttpApi.pull).running;
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
    <ToolbarButton disabled={!enabled} onClick={fetch.execute}>
      <IconArrowDown aria-hidden="true" className="size-3.5" />
      {fetch.fetching ? "Fetching" : "Fetch"}
    </ToolbarButton>
  );
}
