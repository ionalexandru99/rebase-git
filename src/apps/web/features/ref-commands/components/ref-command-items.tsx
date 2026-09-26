import { useMemo } from "react";
import { ContextMenuItem } from "#web/components/ui/context-menu";
import type {
  RefCommandContext,
  RefCommandDefinition,
} from "#web/features/ref-commands/ref-command";
import { createCommandRegistry } from "#web/platform/menu-commands/menu-command";

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
