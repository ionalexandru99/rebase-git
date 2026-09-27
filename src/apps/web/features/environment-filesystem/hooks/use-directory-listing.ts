import { EnvironmentFilesystemApi } from "@rebase/contracts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export function useDirectoryListing(
  path: string | undefined,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    EnvironmentFilesystemApi.listDirectory,
    path === undefined ? {} : { path },
    { enabled, changes: "none", staleTime: 0, refetchOnWindowFocus: false },
  );
}
