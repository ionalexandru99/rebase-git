import { PersistentNotification } from "#web/features/notifications/index";
import { OperationRecoveryToast } from "#web-ui/features/operation-recovery/components/operation-recovery-toast";
import { useOperationRecovery } from "#web-ui/features/operation-recovery/operation-recovery-provider";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

export function OperationRecovery({
  repositoryName,
  writable,
  onReview,
}: {
  readonly repositoryName: string;
  readonly writable: boolean;
  readonly onReview?: () => void;
}) {
  const { controller, state } = useOperationRecovery();
  const panel = useWorkspacePanel();
  if (!state || !controller) return null;
  return (
    <PersistentNotification>
      <OperationRecoveryToast
        state={state}
        repositoryName={repositoryName}
        writable={writable}
        execute={controller.execute}
        refresh={controller.refresh}
        dismiss={controller.dismiss}
        review={() => {
          panel.execute({ type: "open", kind: "changes" });
          onReview?.();
        }}
      />
    </PersistentNotification>
  );
}
