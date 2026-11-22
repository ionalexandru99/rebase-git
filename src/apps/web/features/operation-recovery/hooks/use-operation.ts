import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type OperationScope,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import { useActiveHead } from "#web/features/refs/repository-refs.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

const operationRefreshMilliseconds = 10_000;

export function useOperation(
  scope: OperationScope | undefined,
  polling = false,
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

export function useOperationStart(busy: string) {
  const head = useActiveHead();
  const operation = useOperation(useRepositoryScope()).data;
  const command = useCommand(RepositoryOperationsApi.start, {
    answers: (value, input) => [
      answer(
        RepositoryOperationsApi.read,
        operationScope(input),
        value.operation,
      ),
    ],
  });
  return {
    head,
    run: command.run,
    canRun: command.canRun,
    running: command.running,
    blocked:
      operation !== undefined && operation.kind !== "idle"
        ? `${operationKindLabel(operation.kind)} in progress`
        : command.running
          ? busy
          : undefined,
  };
}

export function useWorktreeOperation(
  scope: OperationScope | undefined,
  { polling = false }: { readonly polling?: boolean } = {},
) {
  const active = useRepositoryScope();
  const matches =
    active !== undefined &&
    scope !== undefined &&
    active.repositoryId === scope.repositoryId &&
    active.worktreePath === scope.worktreePath;
  const matched = matches ? scope : undefined;
  const query = useOperation(matched, polling);
  const disconnectedAt = useDisconnectedAt();
  const busy = useOperationAction(matched).running;
  if (!matches) return null;
  return {
    operation: query.data ?? null,
    checking:
      query.data === undefined ||
      query.isError ||
      query.dataUpdatedAt <= disconnectedAt,
    busy,
    error: query.isError ? describeFailure(query.error) : null,
    refresh: () => void query.refetch(),
    read: async () => (await query.refetch()).data ?? null,
  };
}

function useDisconnectedAt() {
  const { connected } = useEnvironment();
  const [disconnectedAt, setDisconnectedAt] = useState(0);
  useEffect(() => {
    if (!connected) setDisconnectedAt(Date.now());
  }, [connected]);
  return connected ? disconnectedAt : Number.POSITIVE_INFINITY;
}

function operationScope({
  repositoryId,
  worktreePath,
}: OperationScope): OperationScope {
  return { repositoryId, worktreePath };
}
