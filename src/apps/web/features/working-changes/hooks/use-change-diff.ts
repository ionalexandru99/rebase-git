import {
  type ChangesScope,
  type RepositoryChanges,
  RepositoryChangesHttpApi,
  type ViewedChange,
} from "@rebase/contracts";
import { skipToken } from "@tanstack/react-query";
import { changeDiffInput } from "#web/features/working-changes/working-changes-query";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export function useChangeDiff(
  scope: ChangesScope,
  selection: ViewedChange | null,
  changes: RepositoryChanges | undefined,
  enabled: boolean,
) {
  const listed =
    selection !== null &&
    changes?.[selection.section].some((file) => file.path === selection.path);
  return useEnvironmentQuery(
    RepositoryChangesHttpApi.diff,
    listed ? changeDiffInput(scope, selection) : skipToken,
    {
      enabled,
      changes: "none",
      ...(changes === undefined ? {} : { version: changes.revision }),
    },
  );
}
