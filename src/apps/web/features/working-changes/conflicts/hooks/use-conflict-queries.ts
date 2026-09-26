import {
  type ConflictScope,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import { skipToken } from "@tanstack/react-query";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";

export function conflictScope({
  repositoryId,
  worktreePath,
}: ConflictScope): ConflictScope {
  return { repositoryId, worktreePath };
}

export function useConflictList(
  scope: ConflictScope,
  conflicted: boolean,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    RepositoryConflictsHttpApi.list,
    conflicted ? conflictScope(scope) : skipToken,
    {
      enabled,
      changes: "index",
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  );
}

export function useConflictDocument(
  scope: ConflictScope,
  path: string | null,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    RepositoryConflictsHttpApi.document,
    path === null ? skipToken : { ...conflictScope(scope), path },
    {
      enabled,
      changes: "index",
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  );
}
