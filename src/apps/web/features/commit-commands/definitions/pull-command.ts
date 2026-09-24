import type {
  GraphCommandContext,
  GraphCommandDefinition,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";

export function createPullCommand(pull: GraphCommandHandlers["pull"]) {
  return {
    id: "graph.pull",
    group: "Commit graph",
    order: 21,
    placement: "toolbar",
    resolve: (context) => {
      if (pull === undefined) {
        return undefined;
      }
      const branch = context.activeBranch;
      const disabledReason = pullDisabledReason(context);
      return {
        label: "Pull",
        enabled: disabledReason === undefined,
        ...(disabledReason === undefined ? {} : { disabledReason }),
        execute: async () => {
          if (branch !== undefined) pull(branch);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}

function pullDisabledReason(context: GraphCommandContext): string | undefined {
  if (!context.connected) {
    return "Reconnect to pull";
  }
  if (!context.capabilities.has("repository.write")) {
    return "Repository write access is required";
  }
  if (context.activeBranch === undefined) {
    return "Check out a branch to pull";
  }
  if (context.operationState === "busy") {
    return "Wait for the current operation to finish";
  }
  if (!context.freshnessReady) {
    return "Waiting for repository status";
  }
  return undefined;
}
