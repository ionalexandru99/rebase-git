import { useEffect, useMemo, useState } from "react";
import type {
  GraphCommandContext,
  GraphCommandEnvironment,
  GraphCommandHandlers,
  GraphCommandId,
  GraphCommandShortcuts,
} from "#web/features/commit-commands/graph-command.contract";
import { createGraphCommandRegistry } from "#web/features/commit-commands/graph-command-registry";
import { matchesKeyboardShortcut } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";

export function useGraphCommands({
  environment,
  selectedOids,
  handlers,
  shortcuts,
  active = true,
}: {
  readonly environment: GraphCommandEnvironment | undefined;
  readonly selectedOids: readonly string[];
  readonly handlers: GraphCommandHandlers;
  readonly shortcuts: GraphCommandShortcuts | undefined;
  readonly active?: boolean;
}) {
  const registry = useMemo(
    () => createGraphCommandRegistry(handlers),
    [handlers],
  );
  const [error, setError] = useState<string>();
  const context = (
    invokingOid?: string,
    ref?: GraphCommandContext["ref"],
  ): GraphCommandContext | undefined =>
    environment === undefined
      ? undefined
      : {
          ...environment,
          selectedOids,
          ...(invokingOid === undefined ? {} : { invokingOid }),
          ...(ref === undefined ? {} : { ref }),
        };
  const execute = async (
    id: GraphCommandId,
    target: GraphCommandContext | undefined,
  ) => {
    if (target === undefined) return;
    setError(undefined);
    try {
      const result = await registry.execute(id, target);
      if (result._tag === "Unavailable") setError(result.reason);
    } catch {
      setError("The command could not be completed. Try again.");
    }
  };
  useEffect(() => {
    if (shortcuts === undefined || environment === undefined || !active) return;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target: GraphCommandContext = { ...environment, selectedOids };
      const command = registry
        .commands(target)
        .find(
          (candidate) =>
            (candidate.id === "graph.focus" ||
              candidate.id === "graph.fetch") &&
            candidate.enabled &&
            candidate.shortcutId !== undefined &&
            matchesKeyboardShortcut(
              event,
              shortcuts.bindings[candidate.shortcutId],
              shortcuts.platform,
            ),
        );
      if (command === undefined) return;
      event.preventDefault();
      void registry
        .execute(command.id, target)
        .catch(() =>
          setError("The command could not be completed. Try again."),
        );
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [environment, registry, shortcuts, selectedOids, active]);
  return { registry, context, execute, error };
}
