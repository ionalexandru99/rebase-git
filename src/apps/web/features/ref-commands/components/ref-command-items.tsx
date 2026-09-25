import { useMemo } from "react";
import type { RefCommandContext } from "#web/features/ref-commands/ref-command.contract";
import { refCommandSlot } from "#web/features/ref-commands/ref-command-slot";
import { createCommandRegistry } from "#web/platform/command-contributions/command-registry";
import { ContextMenuItem } from "#web-ui/components/ui/context-menu";

export function RefCommandItems({
  context,
}: {
  readonly context: RefCommandContext;
}) {
  const contributions = refCommandSlot.useContributions();
  const registry = useMemo(
    () => createCommandRegistry(contributions),
    [contributions],
  );
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
