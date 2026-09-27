import type { OperationScope, RepositoryOperation } from "@rebase/contracts";
import { useEffect, useState } from "react";
import {
  useOperation,
  useOperationAction,
} from "#web/features/operation-recovery/hooks/use-operation";
import { useEnvironment } from "#web/platform/query/environment-context";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";

export interface OperationStatus {
  readonly operation: RepositoryOperation | null;
  readonly checking: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly read: () => Promise<RepositoryOperation | null>;
}

export function useOperationStatus(
  scope: OperationScope | undefined,
  { polling = false }: { readonly polling?: boolean } = {},
): OperationStatus {
  const query = useOperation(scope, polling);
  const disconnectedAt = useDisconnectedAt();
  const busy = useOperationAction(scope).running;
  return {
    operation: query.data ?? null,
    checking:
      query.data === undefined ||
      query.isError ||
      query.dataUpdatedAt <= disconnectedAt,
    busy: scope !== undefined && busy,
    error: query.isError ? describeFailure(query.error) : null,
    refresh: () => void query.refetch(),
    read: async () => (await query.refetch()).data ?? null,
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

export function useWorktreeOperation(
  scope: OperationScope | undefined,
  options: { readonly polling?: boolean } = {},
) {
  const active = useRepositoryScope();
  const matches =
    active !== undefined &&
    scope !== undefined &&
    active.repositoryId === scope.repositoryId &&
    active.worktreePath === scope.worktreePath;
  const status = useOperationStatus(matches ? scope : undefined, options);
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
