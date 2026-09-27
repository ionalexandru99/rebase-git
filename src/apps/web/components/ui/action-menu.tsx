import { Fragment } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "#web/components/ui/context-menu.tsx";

export interface Action<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly detail?: string;
  readonly keys?: readonly string[];
  readonly group?: "create" | "edit" | "delete";
  readonly run: () => void;
}

export function ActionMenuItems({
  actions,
  className,
  onRun,
}: {
  readonly actions: readonly Action[];
  readonly className?: string;
  readonly onRun?: (action: Action) => void;
}) {
  return actions.map((action, index) => {
    const previous = actions[index - 1]?.group;
    const hint = action.enabled
      ? (action.detail ?? keyLabel(action.keys?.[0]))
      : action.reason;
    return (
      <Fragment key={action.id}>
        {previous !== undefined && previous !== action.group ? (
          <ContextMenuSeparator />
        ) : null}
        <ContextMenuItem
          className={className}
          disabled={!action.enabled}
          onClick={() => {
            onRun?.(action);
            action.run();
          }}
        >
          <span className="flex-1">{action.label}</span>
          {hint === undefined ? null : (
            <span className="text-[.7rem] text-muted-foreground">{hint}</span>
          )}
        </ContextMenuItem>
      </Fragment>
    );
  });
}

export function runAction(action: Action | undefined): boolean {
  if (action?.enabled) action.run();
  return action !== undefined;
}

export function keyAction(actions: readonly Action[], key: string) {
  return actions.find((action) => action.keys?.includes(key));
}

function keyLabel(key: string | undefined) {
  return key === "Delete" ? "Del" : key;
}
