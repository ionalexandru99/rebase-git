import { type ReactNode, useMemo } from "react";
import type { Navigation } from "#web/app/shell/use-navigation";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";
import { useEnvironment } from "#web/platform/query/environment-context";

export function PanelSessions({
  navigation,
  visible,
  children,
}: {
  readonly navigation: Navigation;
  readonly visible: boolean;
  readonly children: ReactNode;
}) {
  const { environmentId, connected, writable } = useEnvironment();
  const environment = useMemo(
    () => ({ environmentId, connected, writable, visible }),
    [environmentId, connected, writable, visible],
  );
  const { environments } = navigation.projects;
  const repositoryIds = useMemo(
    () =>
      environments.flatMap(({ repositories }) =>
        repositories.map(({ id }) => id),
      ),
    [environments],
  );
  return (
    <WorkspacePanel.Sessions
      environment={environment}
      repositoryIds={repositoryIds}
    >
      {children}
    </WorkspacePanel.Sessions>
  );
}
