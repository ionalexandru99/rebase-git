import {
  type OperationScope,
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts";
import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation";
import { describeOperationFailure } from "#web/features/operation-recovery/operation-messages";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { commandKey } from "#web/platform/query/use-command";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export interface OperationStatus {
  readonly operation: RepositoryOperation | null;
  readonly checking: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useOperationStatus(
  scope: OperationScope | undefined,
  { polling = false }: { readonly polling?: boolean } = {},
): OperationStatus {
  const query = useOperation(scope, polling);
  const disconnectedAt = useDisconnectedAt();
  const busy =
    useIsMutating({
      mutationKey: commandKey(RepositoryOperationsHttpApi.execute, scope),
    }) > 0;
  return {
    operation: query.data ?? null,
    checking:
      query.data === undefined ||
      query.isError ||
      query.dataUpdatedAt <= disconnectedAt,
    busy: scope !== undefined && busy,
    error: query.isError ? describeOperationFailure(query.error) : null,
    refresh: () => void query.refetch(),
  };
}

export function useOperationCommandState(): "busy" | "idle" {
  const scope = useRepositoryScope();
  const status = useOperationStatus(scope);
  return scope !== undefined &&
    (status.busy ||
      status.checking ||
      (status.operation !== null && status.operation.kind !== "idle"))
    ? "busy"
    : "idle";
}

export function useWorktreeOperation(scope: OperationScope | undefined) {
  const active = useRepositoryScope();
  const matches =
    active !== undefined &&
    scope !== undefined &&
    active.repositoryId === scope.repositoryId &&
    active.worktreePath === scope.worktreePath;
  const status = useOperationStatus(matches ? scope : undefined);
  return matches ? status : null;
}

function useDisconnectedAt() {
  const { connected } = useEnvironment();
  const [disconnectedAt, setDisconnectedAt] = useState(0);
  useEffect(() => {
    if (!connected) setDisconnectedAt(Date.now());
  }, [connected]);
  return connected ? disconnectedAt : Number.POSITIVE_INFINITY;
}
