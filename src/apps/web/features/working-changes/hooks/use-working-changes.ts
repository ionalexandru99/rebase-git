import { type ChangesScope, RepositoryChangesHttpApi } from "@rebase/contracts";
import { changesScope } from "#web/features/working-changes/working-changes-query";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

const refreshMilliseconds = 10_000;

export function useWorkingChanges(scope: ChangesScope, enabled: boolean) {
  return useEnvironmentQuery(
    RepositoryChangesHttpApi.read,
    changesScope(scope),
    {
      enabled,
      changes: "index",
      staleTime: 0,
      refetchInterval: refreshMilliseconds,
      refetchOnWindowFocus: true,
      keepPrevious: true,
    },
  );
}
