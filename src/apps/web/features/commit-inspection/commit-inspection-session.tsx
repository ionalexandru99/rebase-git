import type { ManagedRuntime } from "effect";
import { useEffect, useMemo } from "react";
import type { CommitInspectionClient } from "#web/features/commit-inspection/commit-inspection.contract";
import { createCommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import { usePanelFeature } from "#web/features/workspace-panel/api";
import { browserWorkingChangesStore } from "#web/persistence/working-changes/working-changes-store";
import { CommitInspection } from "#web-ui/features/commit-inspection/commit-inspection";

export function CommitInspectionSession({
  client,
  repositoryId,
  worktreePath,
  connected,
  runtime,
}: {
  readonly client: CommitInspectionClient;
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly connected: boolean;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
}) {
  const feature = usePanelFeature();
  const controller = useMemo(
    () =>
      createCommitInspectionController(
        client,
        browserWorkingChangesStore,
        { repositoryId, worktreePath },
        runtime,
      ),
    [client, repositoryId, worktreePath, runtime],
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
