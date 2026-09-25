import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { RepositoryHistoryFetchCommands } from "#web/features/repository-history/index";
import { usePullAttempts } from "#web/features/repository-pull/hooks/use-pull-attempts";
import type { RepositoryPullAction } from "#web/features/repository-pull/repository-pull.contract";
import { useRepositoryScope } from "#web/features/repository-scope/index";

interface RepositoryPullContextValue {
  readonly action: RepositoryPullAction | undefined;
  readonly error: { readonly id: number; readonly message: string } | undefined;
}

const RepositoryPullContext = createContext<RepositoryPullContextValue>({
  action: undefined,
  error: undefined,
});

export function RepositoryPullProvider({
  reader,
  incoming,
  children,
}: {
  readonly reader: Pick<RepositoryHistoryFetchCommands, "fetch"> | undefined;
  readonly incoming: number;
  readonly children: ReactNode;
}) {
  const scope = useRepositoryScope();
  const { pull, pulling, error } = usePullAttempts(
    scope?.target.requests,
    scope?.target.repositoryId,
    reader,
  );
  const allowed = scope?.connected === true && scope.writable;
  const value = useMemo(
    () => ({
      action:
        pull === undefined
          ? undefined
          : {
              execute: pull,
              pulling: pulling !== undefined,
              incoming,
              allowed,
            },
      error,
    }),
    [pull, pulling, incoming, allowed, error],
  );
  return (
    <RepositoryPullContext.Provider value={value}>
      {children}
    </RepositoryPullContext.Provider>
  );
}

export function useRepositoryPull() {
  return useContext(RepositoryPullContext).action;
}

export function useRepositoryPullError() {
  return useContext(RepositoryPullContext).error;
}
