import type { OperationScope } from "@rebase/contracts";
import { IconCircleFilled } from "@tabler/icons-react";
import { OperationControls } from "#web/features/operation-recovery/components/operation-controls";
import {
  showsOperationHeader,
  useOperationRecovery,
} from "#web/features/operation-recovery/hooks/use-operation-recovery";
import { operationHeading } from "#web/features/operation-recovery/operation-messages";

export function OperationHeader({ scope }: { readonly scope: OperationScope }) {
  const recovery = useOperationRecovery(scope);
  const { state } = recovery;
  const operation = state.operation;
  if (operation === null || !showsOperationHeader(state)) return null;
  const meta = [operation.branch, operation.commit?.slice(0, 8)]
    .filter((part) => part)
    .join(" · ");
  return (
    <section
      aria-label="Operation"
      className="shrink-0 border-border border-b bg-muted"
    >
      <OperationControls {...recovery} className="min-h-11 px-3 py-1.5">
        <IconCircleFilled
          aria-hidden="true"
          className="size-2 shrink-0 text-status-connecting"
        />
        <h2
          className="text-xs font-semibold"
          aria-live="polite"
          aria-atomic="true"
        >
          {operationHeading(state)}
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {meta}
        </span>
      </OperationControls>
    </section>
  );
}
