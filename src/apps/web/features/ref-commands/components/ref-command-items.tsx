import { useMemo } from "react";
import { ContextMenuItem } from "#web/components/ui/context-menu";
import { createCommandRegistry } from "#web/features/menu-commands/menu-command";
import type {
  RefCommandContext,
  RefCommandDefinition,
} from "#web/features/ref-commands/ref-command.contract";

export function RefCommandItems({
  commands,
  context,
}: {
  readonly commands: readonly RefCommandDefinition[];
  readonly context: RefCommandContext;
}) {
  const registry = useMemo(() => createCommandRegistry(commands), [commands]);
  return registry.commands(context).map((command) => (
    <ContextMenuItem
      key={command.id}
      disabled={!command.enabled}
      onClick={() => void registry.execute(command.id, context)}
    >
      {command.label}
    </ContextMenuItem>
  ));
}
