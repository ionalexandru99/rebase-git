import type { ReactElement } from "react";
import type {
  GraphCommandContext,
  GraphCommandId,
  GraphCommandRegistry,
  GraphCommandShortcuts,
} from "#web/features/commit-commands/graph-command.contract";
import { keyboardShortcutLabel } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "#web-ui/components/ui/context-menu";

export function CommitCommandMenu({
  children,
  context,
  registry,
  execute,
  shortcuts,
  restoreFocus,
  refs = [],
  tabIndex = -1,
}: {
  readonly tabIndex?: number;
  readonly children: ReactElement;
  readonly context: GraphCommandContext | undefined;
  readonly registry: GraphCommandRegistry;
  readonly execute: (
    id: GraphCommandId,
    context: GraphCommandContext,
  ) => Promise<void>;
  readonly shortcuts: GraphCommandShortcuts | undefined;
  readonly restoreFocus: () => void;
  readonly refs?: readonly GraphCommandContext[];
}) {
  if (context === undefined) return children;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) restoreFocus();
      }}
    >
      <ContextMenuTrigger render={children} tabIndex={tabIndex} />
      <ContextMenuContent>
        {refs.map((refContext) => {
          const command = registry
            .commands(refContext)
            .find(({ id }) => id === "history.toggleRef");
          const ref = refContext.ref;
          if (command === undefined || ref === undefined) return null;
          const name =
            ref.target._tag === "RemoteBranch"
              ? `${ref.target.remote}/${ref.target.name}`
              : ref.target.name;
          return (
            <ContextMenuItem
              key={`${ref.target._tag}\0${name}`}
              disabled={!command.enabled}
              onClick={() => void execute(command.id, refContext)}
            >
              {ref.included
                ? `Remove ${name} from history`
                : `Add ${name} to history`}
            </ContextMenuItem>
          );
        })}
        {registry.commands(context).map((command) => (
          <ContextMenuItem
            key={command.id}
            disabled={!command.enabled}
            title={command.disabledReason}
            onClick={() => void execute(command.id, context)}
          >
            <span className="flex-1">{command.label}</span>
            {shortcuts !== undefined && command.shortcutId !== undefined ? (
              <span className="ml-3 text-[10px] text-muted-foreground">
                {keyboardShortcutLabel(
                  shortcuts.bindings[command.shortcutId],
                  shortcuts.platform,
                )}
              </span>
            ) : null}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
