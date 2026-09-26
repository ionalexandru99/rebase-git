import { type ReactElement, useMemo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu";
import type {
  GraphCommandContext,
  GraphCommandDefinition,
} from "#web/features/commit-commands/graph-command.contract";
import type { GraphCommandRun } from "#web/features/commit-commands/use-graph-commands";
import { createCommandRegistry } from "#web/platform/menu-commands/menu-command";

export function CommitCommandMenu({
  children,
  context,
  commands,
  run,
  restoreFocus,
  tabIndex = -1,
}: {
  readonly tabIndex?: number;
  readonly children: ReactElement;
  readonly context: GraphCommandContext | undefined;
  readonly commands: readonly GraphCommandDefinition[];
  readonly run: GraphCommandRun;
  readonly restoreFocus: () => void;
}) {
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) restoreFocus();
      }}
    >
      <ContextMenuTrigger render={children} tabIndex={tabIndex} />
      <ContextMenuContent>
        {context === undefined ? null : (
          <CommitCommandItems commands={commands} context={context} run={run} />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CommitCommandItems({
  commands,
  context,
  run,
}: {
  readonly commands: readonly GraphCommandDefinition[];
  readonly context: GraphCommandContext;
  readonly run: GraphCommandRun;
}) {
  const registry = useMemo(() => createCommandRegistry(commands), [commands]);
  return registry.commands(context).map((command) => (
    <ContextMenuItem
      className="text-[.85rem] sm:text-[.85rem]"
      key={command.id}
      disabled={!command.enabled}
      onClick={() => void run(() => registry.execute(command.id, context))}
    >
      <span className="flex-1">{command.label}</span>
    </ContextMenuItem>
  ));
}
