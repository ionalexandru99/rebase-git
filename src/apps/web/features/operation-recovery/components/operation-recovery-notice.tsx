import { PersistentNotification } from "#web/features/notifications/components/persistent-notification";
import { OperationRecoveryToast } from "#web/features/operation-recovery/components/operation-recovery-toast";
import {
  showsOperationHeader,
  useOperationRecovery,
} from "#web/features/operation-recovery/hooks/use-operation-recovery";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider";

export function OperationRecoveryNotice({
  repositoryName,
}: {
  readonly repositoryName: string;
}) {
  const scope = useRepositoryScope();
  const recovery = useOperationRecovery(scope, { polling: true });
  const panel = useWorkspacePanel();
  if (scope === undefined) return null;
  const diffsVisible = panel.state.open && panel.state.active === "changes";
  if (diffsVisible && showsOperationHeader(recovery.state)) return null;
  return (
    <PersistentNotification>
      <OperationRecoveryToast
        {...recovery}
        repositoryName={repositoryName}
        review={() => panel.execute({ type: "open", kind: "changes" })}
      />
    </PersistentNotification>
  );
}
