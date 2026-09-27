import {
  type ChangesScope,
  type RepositoryChanges,
  RepositoryChangesHttpApi,
} from "@rebase/contracts";
import { skipToken } from "@tanstack/react-query";
import type { SelectedChange } from "#web/features/working-changes/hooks/use-change-selection";
import { changeDiffInput } from "#web/features/working-changes/working-changes-query";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export function useChangeDiff(
  scope: ChangesScope,
  selection: SelectedChange | null,
  changes: RepositoryChanges | undefined,
  enabled: boolean,
) {
  const viewed =
    selection === null || selection.section === "conflicts" ? null : selection;
  const listed =
    viewed !== null &&
    changes?.[viewed.section].some((file) => file.path === viewed.path);
  return useEnvironmentQuery(
    RepositoryChangesHttpApi.diff,
    listed ? changeDiffInput(scope, viewed) : skipToken,
    {
      enabled,
      changes: "none",
      gcTime: 0,
      ...(changes === undefined ? {} : { version: changes.revision }),
    },
  );
}
