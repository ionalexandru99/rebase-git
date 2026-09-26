import { usePanelFeature } from "#web/features/workspace-panel/api";
import { CommitInspection } from "#web-ui/features/commit-inspection/commit-inspection";

export function CommitInspectionPanel() {
  const feature = usePanelFeature();
  const scope = feature?.scope;
  const environment = feature?.environment;
  if (scope === undefined || environment === undefined) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Connect to the environment to inspect commits.
      </p>
    );
  }
  return (
    <CommitInspection
      scope={{
        repositoryId: scope.repositoryId,
        worktreePath: scope.worktreePath,
      }}
      connected={environment.connected}
    />
  );
}
