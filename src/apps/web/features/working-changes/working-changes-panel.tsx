import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool";
import { WorkingChanges } from "#web/features/working-changes/working-changes";
import { usePanelFeature } from "#web/features/workspace-panel/api";

export function WorkingChangesPanel({
  openMergeView,
}: {
  readonly openMergeView?: (path: string) => void;
}) {
  const feature = usePanelFeature();
  if (feature?.scope === undefined || feature.environment === undefined)
    return <Disconnected />;
  const { active, environment, scope } = feature;
  const { connected, writable } = environment;
  const { environmentId, repositoryId, worktreePath } = scope;
  return (
    <DiffWorkerPool>
      {connected ? null : <Disconnected />}
      <div className="h-full min-h-0" hidden={!connected}>
        <WorkingChanges
          target={{
            repositoryId,
            worktreePath,
            draftKey: JSON.stringify([
              environmentId,
              repositoryId,
              worktreePath,
            ]),
            active: connected && active,
          }}
          writable={connected && writable}
          openMergeView={openMergeView}
        />
      </div>
    </DiffWorkerPool>
  );
}

function Disconnected() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      Connect to the repository to review changes.
    </div>
  );
}
