import { IconAlertTriangle } from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "#web/components/ui/button";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification";

export function DeleteRefConfirmation({
  busy,
  children,
  onCancel,
  onConfirm,
  title,
}: {
  readonly busy: boolean;
  readonly children?: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => cancelRef.current?.focus(), []);
  return (
    <PersistentNotification>
      <section
        aria-label={title}
        className="pointer-events-auto rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onCancel();
        }}
        role="alertdialog"
      >
        <div className="flex items-center gap-3">
          <IconAlertTriangle
            aria-hidden="true"
            className="size-4 shrink-0 text-status-connecting"
          />
          <p className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">
            {title}?
          </p>
        </div>
        <div className="mt-1 pl-7 text-xs">
          {children}
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              onClick={onCancel}
              ref={cancelRef}
              size="xs"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={onConfirm}
              size="xs"
              variant="destructive"
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </section>
    </PersistentNotification>
  );
}
