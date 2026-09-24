import { useCallback, useMemo } from "react";
import { repositoryChangesClient } from "#web/features/working-changes/transport/repository-changes-client";
import { usePanelFeature } from "#web/features/workspace-panel/api";
import { WorkingChanges } from "#web-ui/features/working-changes/working-changes";

export function WorkingChangesPanel() {
  const feature = usePanelFeature();
  const requests = feature?.environment?.requests;
  const client = useMemo(
    () => requests && repositoryChangesClient(requests),
    [requests],
  );
  const repositoryId = feature?.scope?.repositoryId;
  const invalidate = feature?.environment?.invalidate;
  const onCommitted = useCallback(() => {
    if (repositoryId) {
      invalidate?.(repositoryId);
    }
  }, [repositoryId, invalidate]);
  return (
    <WorkingChanges
      client={client}
      environmentId={feature?.scope?.environmentId}
      repositoryId={repositoryId}
      worktreePath={feature?.scope?.worktreePath ?? ""}
      changes={feature?.environment?.changes}
      connected={feature?.environment?.connected ?? false}
      writable={feature?.environment?.writable ?? false}
      onCommitted={onCommitted}
      runtime={feature?.environment?.runtime}
    />
  );
}
