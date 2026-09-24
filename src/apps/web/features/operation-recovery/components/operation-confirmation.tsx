import type { OperationAction, RepositoryOperation } from "@rebase/contracts";
import { useEffect, useRef } from "react";
import { Button } from "#web-ui/components/ui/button";

export function OperationConfirmation({
  action,
  operation,
  label,
  disabled,
  cancel,
  confirm,
}: {
  readonly action: OperationAction;
  readonly operation: RepositoryOperation;
  readonly label: string;
  readonly disabled: boolean;
  readonly cancel: () => void;
  readonly confirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButton.current?.focus();
  }, []);
  const subject =
    operation.commit?.slice(0, 8) ??
    (operation.kind === "am" ? "this patch" : "this commit");
  return (
    <div className="border-t border-border p-3">
      <p className="text-xs">
        {action === "abort"
          ? `Abort ${label.toLowerCase()}? Conflict-resolution edits may be lost.`
          : `Skip ${subject}? Its changes will not be included.`}
      </p>
      <div className="mt-3 flex gap-2">
        <Button ref={cancelButton} size="xs" variant="outline" onClick={cancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="destructive"
          disabled={disabled}
          onClick={confirm}
        >
          Confirm {action}
        </Button>
      </div>
    </div>
  );
}
