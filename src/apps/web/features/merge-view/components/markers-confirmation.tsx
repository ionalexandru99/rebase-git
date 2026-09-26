import { useEffect, useRef } from "react";
import { Button } from "#web/components/ui/button";

export function MarkersConfirmation({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      role="alertdialog"
      aria-label="Conflict markers remain"
      className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-1.5 text-xs"
    >
      <span>Conflict markers remain.</span>
      <span className="flex-1" />
      <Button ref={cancel} variant="ghost" size="xs" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="xs" onClick={onConfirm}>
        Mark resolved anyway
      </Button>
    </div>
  );
}
