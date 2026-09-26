import { type ReactNode, useMemo } from "react";
import type { RepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";

export function RepositoryPanelProvider({
  environmentId,
  scope: { repositoryId, logicalRepositoryId, worktreePath },
  children,
}: {
  readonly environmentId: string;
  readonly scope: RepositoryScope;
  readonly children: ReactNode;
}) {
  const scope = useMemo(
    () => ({ environmentId, repositoryId, logicalRepositoryId, worktreePath }),
    [environmentId, repositoryId, logicalRepositoryId, worktreePath],
  );
  return (
    <WorkspacePanel.Provider
      scope={scope}
      scopeKey={JSON.stringify([
        environmentId,
        logicalRepositoryId,
        worktreePath,
      ])}
    >
      {children}
    </WorkspacePanel.Provider>
  );
}
