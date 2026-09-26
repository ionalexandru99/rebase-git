import { CommitInspectionHttpApi, type InspectCommit } from "@rebase/contracts";
import { skipToken } from "@tanstack/react-query";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export type InspectionScope = Pick<
  InspectCommit,
  "repositoryId" | "worktreePath"
>;

export function useCommitInspection(
  { repositoryId, worktreePath }: InspectionScope,
  oid: string | undefined,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    CommitInspectionHttpApi.inspect,
    oid === undefined ? skipToken : { repositoryId, worktreePath, oid },
    { enabled, changes: "none" },
  );
}
