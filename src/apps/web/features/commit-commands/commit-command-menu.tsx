import type { ReactElement } from "react";
import type {
  GraphCommandContext,
  GraphCommandId,
  GraphCommandRegistry,
} from "#web/features/commit-commands/graph-command.contract";
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
              className="text-[.85rem] sm:text-[.85rem]"
              key={command.id}
              disabled={!command.enabled}
              onClick={() => void execute(command.id, context)}
            >
              <span className="flex-1">{command.label}</span>
            </ContextMenuItem>
          ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
