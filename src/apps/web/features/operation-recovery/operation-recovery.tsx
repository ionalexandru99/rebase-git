import { PersistentNotification } from "#web/features/notifications/index";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { OperationRecoveryToast } from "#web-ui/features/operation-recovery/components/operation-recovery-toast";
import {
  OperationRecoveryProvider,
  useOperationRecovery,
} from "#web-ui/features/operation-recovery/operation-recovery-provider";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/index";

function OperationRecoveryNotice({
  repositoryName,
}: {
  readonly repositoryName: string;
}) {
  const recovery = useOperationRecovery();
  const writable = useRepositoryScope()?.writable ?? false;
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

export const OperationRecovery = {
  Provider: OperationRecoveryProvider,
  Notice: OperationRecoveryNotice,
};
