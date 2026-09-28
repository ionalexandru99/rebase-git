import { IconChevronRight } from "@tabler/icons-react";
import { Fragment } from "react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
  ContextMenuSubmenuTrigger,
} from "#web/components/ui/context-menu.tsx";

export interface Action<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly detail?: string;
  readonly keys?: readonly string[];
  readonly group?: "create" | "edit" | "delete" | "operation";
  readonly onHighlight?: (highlighted: boolean) => void;
  readonly submenu?: {
    readonly title: string;
    readonly actions: readonly Action[];
  };
  readonly run: () => void;
}

export function ActionMenuItems({
  actions,
  className,
  onRun,
}: {
  readonly actions: readonly Action[];
  readonly className?: string | undefined;
  readonly onRun?: (action: Action) => void;
}) {
  return actions.map((action, index) => {
    const previous = actions[index - 1]?.group;
    const hint = action.enabled
      ? (action.detail ?? keyLabel(action.keys?.[0]))
      : action.reason;
    const label = <span className="flex-1">{action.label}</span>;
    const hinted =
      hint === undefined ? null : (
        <span className="text-[.7rem] text-muted-foreground">{hint}</span>
      );
    return (
      <Fragment key={action.id}>
        {previous !== undefined && previous !== action.group ? (
          <ContextMenuSeparator />
        ) : null}
        {action.submenu === undefined ? (
          <ContextMenuItem
            className={className}
            disabled={!action.enabled}
            onFocus={() => action.onHighlight?.(true)}
            onBlur={() => action.onHighlight?.(false)}
            onClick={() => {
              onRun?.(action);
              action.run();
            }}
          >
            {label}
            {hinted}
          </ContextMenuItem>
        ) : (
          <ContextMenuSubmenu disabled={!action.enabled}>
            <ContextMenuSubmenuTrigger className={className}>
              {label}
              {hinted}
              <IconChevronRight
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            </ContextMenuSubmenuTrigger>
            <ContextMenuContent submenu className="w-72">
              <p className="mb-1 truncate border-border border-b px-2 pt-1 pb-1.5 font-mono text-[.7rem] text-muted-foreground">
                {action.submenu.title}
              </p>
              <ActionMenuItems
                actions={action.submenu.actions}
                className={className}
                {...(onRun === undefined ? {} : { onRun })}
              />
            </ContextMenuContent>
          </ContextMenuSubmenu>
        )}
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
