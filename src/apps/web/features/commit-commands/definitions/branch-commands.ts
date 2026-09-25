import type {
  GraphCommandDefinition,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";

export function createBranchHereCommand(
  createBranch: GraphCommandHandlers["createBranch"],
) {
  return {
    id: "graph.createBranch",
    group: "Commit",
    order: 10,
    placement: "commit-menu",
    resolve: (context) => {
      const oid = context.invokingOid;
      if (oid === undefined || createBranch === undefined) return undefined;
      return {
        label: "Create branch here…",
        enabled:
          context.connected && context.capabilities.has("repository.write"),
        execute: async () => {
          createBranch(oid);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}
