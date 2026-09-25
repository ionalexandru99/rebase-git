import { createContext, type ReactNode, useContext } from "react";
import type { RepositoryScope } from "#web/features/repository-scope/repository-scope.contract";

const RepositoryScopeContext = createContext<RepositoryScope | undefined>(
  undefined,
);

export function RepositoryScopeProvider({
  scope,
  children,
}: {
  readonly scope: RepositoryScope | undefined;
  readonly children: ReactNode;
}) {
  return (
    <RepositoryScopeContext.Provider value={scope}>
      {children}
    </RepositoryScopeContext.Provider>
  );
}

export function useRepositoryScope() {
  return useContext(RepositoryScopeContext);
}
