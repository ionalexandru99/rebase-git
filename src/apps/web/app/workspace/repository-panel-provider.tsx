import { type ReactNode, useMemo } from "react";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";
import type { RepositoryScope } from "#web/platform/query/repository-scope";

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
