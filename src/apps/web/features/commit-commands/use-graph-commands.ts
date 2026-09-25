import { useCallback, useMemo, useState } from "react";
import {
  type CommitCommandId,
  createCommitCommandDefinitions,
} from "#web/features/commit-commands/commit-command-definitions";
import type {
  CommitCommandHandlers,
  GraphCommandContext,
} from "#web/features/commit-commands/graph-command.contract";
import type { CommandResult } from "#web/platform/command-contributions/command-contributions.contract";
import { createCommandRegistry } from "#web/platform/command-contributions/command-registry";

export type GraphCommandRun = (
  command: () => Promise<CommandResult>,
) => Promise<void>;

export function useGraphCommands(handlers: CommitCommandHandlers) {
  const definitions = useMemo(
    () => createCommitCommandDefinitions(handlers),
    [handlers],
  );
  const registry = useMemo(
    () => createCommandRegistry(definitions),
    [definitions],
  );
  const [error, setError] = useState<string>();
  const run = useCallback<GraphCommandRun>(async (command) => {
    setError(undefined);
    try {
      const result = await command();
      if (result._tag === "Unavailable") setError(result.reason);
    } catch {
      setError("The command could not be completed. Try again.");
    }
  }, []);
  const execute = (id: CommitCommandId, context: GraphCommandContext) =>
    run(() => registry.execute(id, context));
  return { definitions, run, execute, error };
}
