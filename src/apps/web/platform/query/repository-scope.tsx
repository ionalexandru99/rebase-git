import { createContext, type ReactNode, useContext } from "react";

export interface RepositoryScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly logicalRepositoryId: string;
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly switchWorktree: (worktreePath: string) => void;
}

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
