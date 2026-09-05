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
        {registry
          .commands(context)
          .filter(
            (command) =>
              command.id === "graph.copySha" ||
              command.id === "graph.copySubject",
          )
          .map((command) => (
            <ContextMenuItem
              key={command.id}
              disabled={!command.enabled}
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
