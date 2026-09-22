import { useMemo } from "react";
import { commitInspectionClient } from "#web/features/commit-inspection/transport/commit-inspection-client";
import { usePanelFeature } from "#web/features/workspace-panel/api";
import { CommitInspectionSession } from "#web-ui/features/commit-inspection/commit-inspection-session";

export function CommitInspectionPanel() {
  const feature = usePanelFeature();
  const requests = feature?.environment?.requests;
  const client = useMemo(
    () => requests && commitInspectionClient(requests),
    [requests],
  );
  if (!client || !feature?.scope) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Connect to the environment to inspect commits.
      </p>
    );
  }
  return (
    <CommitInspectionSession
      client={client}
      repositoryId={feature.scope.repositoryId}
      worktreePath={feature.scope.worktreePath}
      connected={feature.environment?.connected ?? false}
    />
  );
}
