import { IconChevronRight } from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
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
  readonly icon?: ReactNode;
  readonly keys?: readonly string[];
  readonly group?: "operation" | "edit" | "delete";
  readonly onHighlight?: (highlighted: boolean) => void;
  readonly submenu?: {
    readonly actions: readonly Action<Id>[];
    readonly lead?: ReactNode;
  };
  readonly run: () => void;
}

export function ActionMenuItems({
  actions,
  onRun,
}: {
  readonly actions: readonly Action[];
  readonly onRun?: (action: Action) => void;
}) {
  return actions.map((action, index) => {
    const previous = actions[index - 1];
    const hint = action.enabled
      ? (action.detail ?? keyLabel(action.keys?.[0]))
      : action.reason;
    const label = (
      <>
        {action.icon}
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
      </>
    );
    const hinted =
      hint === undefined ? null : (
        <span className="shrink-0 whitespace-nowrap text-[.7rem] text-muted-foreground">
          {hint}
        </span>
      );
    return (
      <Fragment key={action.id}>
        {previous !== undefined && previous.group !== action.group ? (
          <ContextMenuSeparator />
        ) : null}
        {action.submenu === undefined ? (
          <ContextMenuItem
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
            <ContextMenuSubmenuTrigger
              onFocus={() => action.onHighlight?.(true)}
              onBlur={() => action.onHighlight?.(false)}
            >
              {label}
              {hinted}
              <IconChevronRight
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            </ContextMenuSubmenuTrigger>
            <ContextMenuContent submenu className="w-max min-w-40 max-w-md">
              {action.submenu.lead}
              <ActionMenuItems
                actions={action.submenu.actions}
                {...(onRun === undefined ? {} : { onRun })}
              />
            </ContextMenuContent>
          </ContextMenuSubmenu>
        )}
      </Fragment>
    );
  });
}

export function submenu<Id extends string>(
  parent: Pick<Action<Id>, "id" | "label" | "group">,
  choices: readonly Action<Id>[],
): Action<Id> {
  const enabled = choices.some((choice) => choice.enabled);
  const reason = enabled ? undefined : choices[0]?.reason;
  return {
    ...parent,
    enabled,
    ...(reason === undefined ? {} : { reason }),
    run: () => undefined,
    submenu: { actions: choices },
  };
}

export function runAction(action: Action | undefined): boolean {
  if (action?.enabled) action.run();
  return action !== undefined;
}

export function keyAction(actions: readonly Action[], key: string) {
  return everyAction(actions).find((action) => action.keys?.includes(key));
}

export function everyAction<Id extends string>(
  actions: readonly Action<Id>[],
): readonly Action<Id>[] {
  return actions.flatMap((action) => [
    action,
    ...everyAction(action.submenu?.actions ?? []),
  ]);
}

export function replaceRuns<Id extends string>(
  actions: readonly Action<Id>[],
  run: (action: Action<Id>) => () => void,
): readonly Action<Id>[] {
  return actions.map((action) => ({
    ...action,
    run: run(action),
    ...(action.submenu === undefined
      ? {}
      : { submenu: { actions: replaceRuns(action.submenu.actions, run) } }),
  }));
}

function keyLabel(key: string | undefined) {
  return key === "Delete" ? "Del" : key;
}
