import { PersistentNotification } from "#web/features/notifications/index";
import { OperationRecoveryToast } from "#web-ui/features/operation-recovery/components/operation-recovery-toast";
import { useOperationRecovery } from "#web-ui/features/operation-recovery/operation-recovery-provider";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/index";

export function OperationRecovery({
  repositoryName,
  writable,
}: {
  readonly repositoryName: string;
  readonly writable: boolean;
}) {
  const recovery = useOperationRecovery();
  const panel = useWorkspacePanel();
  if (recovery === null) return null;
  const { controller, state } = recovery;
  return (
    <PersistentNotification>
      <OperationRecoveryToast
        state={state}
        repositoryName={repositoryName}
        writable={writable}
        execute={controller.execute}
        refresh={controller.checkAgain}
        dismiss={controller.dismiss}
        review={() => panel.execute({ type: "open", kind: "changes" })}
      />
    </PersistentNotification>
  );
}
