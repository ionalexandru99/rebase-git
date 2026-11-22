import { type ReactNode, useState } from "react";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import type { WorkspacePanelScope } from "#web/features/workspace-panel/workspace-panel-session.ts";

export function workspacePanelScope(
  scope: Partial<WorkspacePanelScope> = {},
): WorkspacePanelScope {
  const repositoryId = scope.repositoryId ?? crypto.randomUUID();
  return {
    environmentId: "environment",
    repositoryId,
    logicalRepositoryId: repositoryId,
    worktreePath: "/repo",
    ...scope,
  };
}

export function saveWorkspacePanel(scope: WorkspacePanelScope, saved: object) {
  localStorage.setItem(workspacePanelStorageKey(scope), JSON.stringify(saved));
}

export function savedWorkspacePanel(scope: WorkspacePanelScope): unknown {
  return JSON.parse(
    localStorage.getItem(workspacePanelStorageKey(scope)) ?? "null",
  );
}

export function TestWorkspacePanel({
  scope,
  children,
}: {
  readonly scope?: WorkspacePanelScope;
  readonly children: ReactNode;
}) {
  const [fallback] = useState(workspacePanelScope);
  return (
    <WorkspacePanel.Sessions>
      <WorkspacePanel.Provider scope={scope ?? fallback}>
        {children}
      </WorkspacePanel.Provider>
    </WorkspacePanel.Sessions>
  );
}

function workspacePanelStorageKey(scope: WorkspacePanelScope) {
  return `rebase:workspace-panel:v1:${JSON.stringify([
    scope.environmentId,
    scope.repositoryId,
    scope.logicalRepositoryId,
    scope.worktreePath,
  ])}`;
}
