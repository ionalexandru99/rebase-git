import type { ReactElement } from "react";
import type {
  GraphCommandContext,
  GraphCommandRegistry,
} from "#web/features/commit-commands/graph-command.contract";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "#web-ui/components/ui/context-menu";

export function CommitCommandMenu<Id extends string>({
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
  readonly registry: GraphCommandRegistry<Id>;
  readonly execute: (id: Id, context: GraphCommandContext) => Promise<void>;
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
        {registry.commands(context, "commit-menu").map((command) => (
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
