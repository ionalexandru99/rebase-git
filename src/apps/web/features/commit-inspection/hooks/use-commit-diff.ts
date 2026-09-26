import {
  type CommitInspection,
  CommitInspectionHttpApi,
  type InspectCommitDiff,
} from "@rebase/contracts";
import { skipToken } from "@tanstack/react-query";
import type { InspectionScope } from "#web/features/commit-inspection/hooks/use-commit-inspection";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export function useCommitDiff(
  scope: InspectionScope,
  details: CommitInspection | undefined,
  path: string | null,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    CommitInspectionHttpApi.inspectDiff,
    details === undefined || path === null
      ? skipToken
      : commitDiffInput(scope, details, path),
    { enabled, changes: "none" },
  );
}

function commitDiffInput(
  { repositoryId, worktreePath }: InspectionScope,
  details: CommitInspection,
  path: string,
): InspectCommitDiff {
  const previousPath = details.files.find(
    (file) => file.path === path,
  )?.previousPath;
  return {
    repositoryId,
    worktreePath,
    oid: details.oid,
    ...(details.parentOid === null ? {} : { parentOid: details.parentOid }),
    path,
    ...(previousPath == null ? {} : { previousPath }),
  };
}
