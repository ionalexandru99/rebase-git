import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import type {
  GraphCommandContext,
  GraphCommandId,
  GraphCommandRegistry,
} from "#web/features/commit-commands/graph-command.contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "#web-ui/components/ui/dropdown-menu";

export function CommitRefLabels(props: ComponentProps<typeof CommitRefMenu>) {
  return props.labels.length === 0 ? null : <CommitRefMenu {...props} />;
}

function CommitRefMenu({
  labels,
  context,
  registry,
  execute,
  restoreFocus,
}: {
  readonly labels: readonly RepositoryHistoryRefTarget[];
  readonly context: (
    label: RepositoryHistoryRefTarget,
  ) => GraphCommandContext | undefined;
  readonly registry: GraphCommandRegistry;
  readonly execute: (
    id: GraphCommandId,
    context: GraphCommandContext,
  ) => Promise<void>;
  readonly restoreFocus: () => void;
}) {
  const menuId = useId();
  const [menu, setMenu] = useState<{
    readonly anchor: HTMLButtonElement;
    readonly key: string;
    readonly focusKey?: "ArrowDown" | "ArrowUp";
  }>();
  const menuLabels =
    menu?.key === "overflow"
      ? labels.slice(2)
      : labels.filter((label) => labelKey(label) === menu?.key);
  useEffect(() => {
    if (menu !== undefined && menuLabels.length === 0) setMenu(undefined);
  }, [menu, menuLabels.length]);
  const trigger = (
    key: string,
    className: string,
    name: string,
    children: ReactNode,
    title?: string,
  ) => (
    <RefMenuTrigger
      key={key}
      className={className}
      name={name}
      title={title}
      menuId={menu?.key === key ? menuId : undefined}
      onOpen={(anchor, focusKey) => {
        if (menu?.anchor === anchor) {
          setMenu(undefined);
          restoreFocus();
        } else
          setMenu({
            anchor,
            key,
            ...(focusKey === undefined ? {} : { focusKey }),
          });
      }}
    >
      {children}
    </RefMenuTrigger>
  );
  return (
    <span className="flex min-w-0 max-w-[55%] shrink-0 items-center gap-1 overflow-hidden">
      {labels.slice(0, 2).map((label) => {
        const target = context(label);
        const command =
          target === undefined
            ? undefined
            : registry
                .commands(target)
                .find(({ id }) => id === "history.toggleRef");
        const className = `min-w-0 max-w-32 truncate rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none ${label.type === "tag" ? "border-status-connecting/35 bg-status-connecting/10 text-status-connecting" : label.type === "branch" ? "border-status-available/30 bg-status-available/8 text-status-available" : "border-primary/30 bg-primary/8 text-primary"}`;
        if (command === undefined || target === undefined)
          return (
            <span
              className={className}
              title={label.name}
              key={`${label.type}\0${label.name}`}
            >
              {label.name}
            </span>
          );
        return trigger(
          labelKey(label),
          className,
          `Actions for ${label.name}`,
          label.name,
          label.name,
        );
      })}
      {labels.length <= 2
        ? null
        : trigger(
            "overflow",
            "shrink-0 rounded-sm border border-border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground",
            `${labels.length - 2} more refs`,
            `+${labels.length - 2}`,
          )}
      {menu === undefined || menuLabels.length === 0 ? null : (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) {
              setMenu(undefined);
              restoreFocus();
            }
          }}
        >
          <DropdownMenuContent
            anchor={menu.anchor}
            id={menuId}
            finalFocus={false}
            aria-label={menu.anchor.getAttribute("aria-label") ?? undefined}
            onFocus={(event) => {
              if (
                event.target === event.currentTarget &&
                menu.focusKey !== undefined
              )
                event.currentTarget.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    bubbles: true,
                    key: menu.focusKey,
                  }),
                );
            }}
          >
            {menuLabels.map((label) => {
              const target = context(label);
              const command =
                target === undefined
                  ? undefined
                  : registry
                      .commands(target)
                      .find(({ id }) => id === "history.toggleRef");
              return (
                <DropdownMenuItem
                  key={`${label.type}\0${label.name}`}
                  disabled={command === undefined || !command.enabled}
                  title={command?.disabledReason}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (command !== undefined && target !== undefined)
                      void execute(command.id, target);
                  }}
                >
                  {menu.key === "overflow" ? (
                    <>
                      <span className="font-mono">{label.name}</span>
                      {command === undefined ? null : (
                        <span className="ml-auto text-muted-foreground">
                          {command.label}
                        </span>
                      )}
                    </>
                  ) : (
                    command?.label
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}

function RefMenuTrigger({
  children,
  className,
  menuId,
  name,
  onOpen,
  title,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly menuId: string | undefined;
  readonly name: string;
  readonly onOpen: (
    anchor: HTMLButtonElement,
    focusKey?: "ArrowDown" | "ArrowUp",
  ) => void;
  readonly title: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-controls={menuId}
      aria-expanded={menuId !== undefined}
      aria-haspopup="menu"
      aria-label={name}
      className={className}
      title={title}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(
          event.currentTarget,
          event.detail === 0 ? "ArrowDown" : undefined,
        );
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          onOpen(event.currentTarget, event.key);
        }
      }}
    >
      {children}
    </button>
  );
}

function labelKey(label: RepositoryHistoryRefTarget) {
  return `${label.type}\0${label.name}`;
}

export function historyLabelTarget(
  label: RepositoryHistoryRefTarget,
): RepositoryRefTarget | undefined {
  if (label.type === "branch") return { _tag: "LocalBranch", name: label.name };
  if (label.type === "tag") return { _tag: "Tag", name: label.name };
  if (label.type === "remote-branch") {
    const separator = label.name.indexOf("/");
    if (separator > 0)
      return {
        _tag: "RemoteBranch",
        remote: label.name.slice(0, separator),
        name: label.name.slice(separator + 1),
      };
  }
  return undefined;
}
