import { useCallback, useMemo, useState } from "react";
import {
  type CommitCommandId,
  createCommitCommandDefinitions,
} from "#web/features/commit-commands/commit-command-definitions";
import type {
  CommitCommandHandlers,
  GraphCommandContext,
  GraphCommandDefinition,
} from "#web/features/commit-commands/graph-command";
import type { CommandResult } from "#web/platform/menu-commands/menu-command";
import { createCommandRegistry } from "#web/platform/menu-commands/menu-command";

export type GraphCommandRun = (
  command: () => Promise<CommandResult>,
) => Promise<void>;

const noExtraCommands: readonly GraphCommandDefinition[] = [];

export function useGraphCommands(
  handlers: CommitCommandHandlers,
  extraCommands = noExtraCommands,
) {
  const commitDefinitions = useMemo(
    () => createCommitCommandDefinitions(handlers),
    [handlers],
  );
  const registry = useMemo(
    () => createCommandRegistry(commitDefinitions),
    [commitDefinitions],
  );
  const definitions = useMemo(
    () => [...commitDefinitions, ...extraCommands],
    [commitDefinitions, extraCommands],
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
