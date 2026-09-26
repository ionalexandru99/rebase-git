import {
  type OperationScope,
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import {
  environmentQueryKey,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";
import { useCommand } from "#web/platform/query/use-command";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

const operationRefreshMilliseconds = 10_000;

export function useOperation(scope: OperationScope | undefined) {
  return useEnvironmentQuery(
    RepositoryOperationsHttpApi.read,
    scope === undefined ? skipToken : operationScope(scope),
    {
      changes: "index",
      refetchOnWindowFocus: "always",
      refetchInterval: operationRefreshMilliseconds,
    },
  );
}

export function useOperationAction(scope: OperationScope | undefined) {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  const operationKey = (scope: OperationScope) =>
    environmentQueryKey(
      environmentId,
      scope.repositoryId,
      RepositoryOperationsHttpApi.read,
      operationScope(scope),
    );
  return useCommand(RepositoryOperationsHttpApi.execute, {
    repository: scope,
    onSuccess: async (operation: RepositoryOperation, command) => {
      const queryKey = operationKey(command);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, operation);
    },
    onError: (_error, command) =>
      queryClient.invalidateQueries({ queryKey: operationKey(command) }),
  });
}

function operationScope({
  repositoryId,
  worktreePath,
}: OperationScope): OperationScope {
  return { repositoryId, worktreePath };
}
