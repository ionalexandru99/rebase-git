import { Menu } from "@base-ui/react/menu";
import type { OperationAction, RepositoryOperation } from "@rebase/contracts";
import { useRef } from "react";
import { Button } from "#web-ui/components/ui/button";

export function OperationActionsMenu({
  operation,
  disabled,
  choose,
}: {
  readonly operation: RepositoryOperation;
  readonly disabled: boolean;
  readonly choose: (action: OperationAction) => void;
}) {
  const chosen = useRef(false);
  const actions = operation.actions.filter(
    (action) => action.action !== "continue",
  );
  if (actions.length === 0) return null;
  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) chosen.current = false;
      }}
    >
      <Menu.Trigger
        render={<Button size="xs" variant="ghost" />}
        disabled={disabled}
      >
        Actions
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-110">
          <Menu.Popup
            finalFocus={() => !chosen.current}
            className="w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          >
            {actions.map(({ action, enabled, reason }) => (
              <Menu.Item
                key={action}
                disabled={!enabled}
                aria-description={reason ?? undefined}
                onClick={() => {
                  chosen.current = true;
                  choose(action);
                }}
                className={`rounded px-2 py-2 text-xs outline-none data-highlighted:bg-accent data-disabled:opacity-50 ${action === "abort" ? "text-destructive" : ""}`}
              >
                {action === "skip"
                  ? operation.kind === "am"
                    ? "Skip patch…"
                    : "Skip commit…"
                  : "Abort…"}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
