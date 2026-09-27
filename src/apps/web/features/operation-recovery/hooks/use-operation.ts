import {
  type OperationScope,
  RepositoryOperationsApi,
} from "@rebase/contracts";
import { skipToken } from "@tanstack/react-query";
import { useEnvironmentQuery } from "#web/platform/query/environment-query";
import { answer, useCommand } from "#web/platform/query/use-command";

const operationRefreshMilliseconds = 10_000;

export function useOperation(
  scope: OperationScope | undefined,
  polling: boolean,
) {
  return useEnvironmentQuery(
    RepositoryOperationsApi.read,
    scope === undefined ? skipToken : operationScope(scope),
    {
      changes: "index",
      refetchOnWindowFocus: "always",
      ...(polling ? { refetchInterval: operationRefreshMilliseconds } : {}),
    },
  );
}

export function useOperationAction(scope: OperationScope | undefined) {
  return useCommand(RepositoryOperationsApi.execute, {
    target: scope,
    answers: (operation, input) => [
      answer(RepositoryOperationsApi.read, operationScope(input), operation),
    ],
  });
}

function operationScope({
  repositoryId,
  worktreePath,
}: OperationScope): OperationScope {
  return { repositoryId, worktreePath };
}
