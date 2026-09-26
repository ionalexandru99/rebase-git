import type { RepositoryRefs } from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { repositoryRefsKey } from "#web/features/repository-refs/repository-refs-query";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export function useApplyToRefs() {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  const logicalRepositoryId = useRepositoryScope()?.logicalRepositoryId;
  return useCallback(
    async (change: (refs: RepositoryRefs) => RepositoryRefs) => {
      if (logicalRepositoryId === undefined) return;
      const queryKey = repositoryRefsKey(environmentId, logicalRepositoryId);
      const reading = queryClient.isFetching({ queryKey }) > 0;
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<RepositoryRefs>(queryKey, (refs) =>
        refs === undefined ? refs : change(refs),
      );
      if (reading) void queryClient.invalidateQueries({ queryKey });
    },
    [environmentId, logicalRepositoryId, queryClient],
  );
}
