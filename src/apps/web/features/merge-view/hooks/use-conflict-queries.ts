import {
  type ConflictDocument,
  type ConflictList,
  type ConflictPath,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useEnvironment } from "#web/platform/query/environment-context";
import {
  environmentQueryKey,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";

export function useConflictQueries({
  repositoryId,
  worktreePath,
  path,
}: ConflictPath) {
  const { environmentId } = useEnvironment();
  const queryClient = useQueryClient();
  const document = useEnvironmentQuery(
    RepositoryConflictsHttpApi.document,
    { repositoryId, worktreePath, path },
    { changes: "index" },
  );
  const list = useEnvironmentQuery(
    RepositoryConflictsHttpApi.list,
    { repositoryId, worktreePath },
    { changes: "index" },
  );
  const storeDocument = useCallback(
    (value: ConflictDocument) =>
      queryClient.setQueryData(
        environmentQueryKey(
          environmentId,
          repositoryId,
          RepositoryConflictsHttpApi.document,
          { repositoryId, worktreePath, path },
        ),
        value,
      ),
    [environmentId, path, queryClient, repositoryId, worktreePath],
  );
  const storeList = useCallback(
    (value: ConflictList) =>
      queryClient.setQueryData(
        environmentQueryKey(
          environmentId,
          repositoryId,
          RepositoryConflictsHttpApi.list,
          { repositoryId, worktreePath },
        ),
        value,
      ),
    [environmentId, queryClient, repositoryId, worktreePath],
  );
  return { document, list, storeDocument, storeList };
}
