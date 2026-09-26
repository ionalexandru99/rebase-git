import { useEffect, useRef } from "react";
import { Button } from "#web/components/ui/button";

export function MarkersConfirmation({
  path,
  disabled,
  cancel,
  confirm,
}: {
  readonly path: string;
  readonly disabled: boolean;
  readonly cancel: () => void;
  readonly confirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButton.current?.focus();
  }, []);
  return (
    <fieldset
      aria-label={`Conflict markers remain in ${path}`}
      className="flex shrink-0 items-center gap-1"
    >
      <Button ref={cancelButton} size="xs" variant="ghost" onClick={cancel}>
        Cancel
      </Button>
      <Button
        size="xs"
        variant="destructive"
        disabled={disabled}
        onClick={confirm}
      >
        Mark resolved anyway
      </Button>
    </fieldset>
  );
}
