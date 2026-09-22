import { useEffect, useMemo } from "react";
import type { CommitInspectionClient } from "#web/features/commit-inspection/commit-inspection.contract";
import { createCommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import { usePanelFeature } from "#web/features/workspace-panel/api";
import { CommitInspection } from "#web-ui/features/commit-inspection/commit-inspection";

export function CommitInspectionSession({
  client,
  repositoryId,
  worktreePath,
  connected,
}: {
  readonly client: CommitInspectionClient;
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly connected: boolean;
}) {
  const feature = usePanelFeature();
  const controller = useMemo(
    () =>
      createCommitInspectionController(client, { repositoryId, worktreePath }),
    [client, repositoryId, worktreePath],
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(
    () => controller.setActive(connected && (feature?.active ?? true)),
    [controller, connected, feature?.active],
  );
  useEffect(() => {
    if (typeof feature?.input === "string") {
      controller.selectCommit(feature.input);
    }
  }, [controller, feature?.input]);
  return <CommitInspection controller={controller} connected={connected} />;
}
