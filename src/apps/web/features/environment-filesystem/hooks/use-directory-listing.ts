import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export function useDirectoryListing(
  path: string | undefined,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    EnvironmentFilesystemHttpApi.listDirectory,
    path === undefined ? {} : { path },
    { enabled, changes: "none", staleTime: 0 },
  );
}
