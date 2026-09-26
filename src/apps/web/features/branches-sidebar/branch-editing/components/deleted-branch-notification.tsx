import { IconCircleCheck, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import { Button } from "#web/components/ui/button";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification";

const visibleMilliseconds = 10_000;

export function DeletedBranchNotification({
  name,
  onDismiss,
  onUndo,
}: {
  readonly name: string;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, visibleMilliseconds);
    return () => clearTimeout(timeout);
  }, [onDismiss]);
  return (
    <PersistentNotification>
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
        role="status"
      >
        <IconCircleCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-status-available"
        />
        <p className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">
          Deleted {name}
        </p>
        <Button onClick={onUndo} size="xs" variant="ghost">
          Undo
        </Button>
        <Button
          aria-label="Dismiss notification"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          <IconX aria-hidden="true" />
        </Button>
      </div>
    </PersistentNotification>
  );
}
