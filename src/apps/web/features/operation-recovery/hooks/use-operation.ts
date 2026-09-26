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
  const { readable } = useEnvironment();
  return useEnvironmentQuery(
    RepositoryOperationsHttpApi.read,
    scope === undefined ? skipToken : operationScope(scope),
    {
      enabled: readable,
      changes: "refs",
      refetchOnWindowFocus: "always",
      refetchInterval: operationRefreshMilliseconds,
    },
  );
}

export function useOperationAction() {
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
