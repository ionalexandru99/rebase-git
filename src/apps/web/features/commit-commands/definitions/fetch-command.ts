import type {
  GraphCommandContext,
  GraphCommandDefinition,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";

export function createFetchCommand(fetch: GraphCommandHandlers["fetch"]) {
  return {
    id: "graph.fetch",
    group: "Commit graph",
    order: 20,
    placement: "toolbar",
    resolve: (context) => {
      if (fetch === undefined) {
        return undefined;
      }
      const disabledReason = fetchDisabledReason(context);
      return {
        label: "Fetch",
        enabled: disabledReason === undefined,
        ...(disabledReason === undefined ? {} : { disabledReason }),
        execute: async () => {
          await fetch(context);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}

function fetchDisabledReason(context: GraphCommandContext): string | undefined {
  if (!context.connected) {
    return "Reconnect to fetch";
  }
  if (!context.capabilities.has("repository.write")) {
    return "Repository write access is required";
  }
  if (context.operationState === "fetching") {
    return "A fetch is already running";
  }
  if (context.operationState === "busy") {
    return "Wait for the current operation to finish";
  }
  if (!context.freshnessReady) {
    return "Waiting for repository status";
  }
  return undefined;
}
