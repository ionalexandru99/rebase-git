import { useMemo, useState } from "react";
import type {
  GraphCommandContext,
  GraphCommandEnvironment,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";
import {
  createGraphCommandDefinitions,
  type GraphCommandId,
} from "#web/features/commit-commands/graph-command-definitions";
import { createGraphCommandRegistry } from "#web/features/commit-commands/graph-command-registry";

export function useGraphCommands({
  environment,
  selectedOids,
  handlers,
}: {
  readonly environment: GraphCommandEnvironment | undefined;
  readonly selectedOids: readonly string[];
  readonly handlers: GraphCommandHandlers;
}) {
  const registry = useMemo(
    () => createGraphCommandRegistry(createGraphCommandDefinitions(handlers)),
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
  return { registry, context, execute, error };
}
