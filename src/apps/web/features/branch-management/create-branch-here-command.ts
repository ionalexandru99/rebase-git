import type { GraphCommandDefinition } from "#web/features/commit-commands/index";

export function createBranchHereCommand(
  requestCreate: (oid: string) => void,
): GraphCommandDefinition {
  return {
    id: "branch.createHere",
    order: 10,
    resolve: (context) => ({
      label: "Create branch here…",
      enabled: context.connected && context.writable,
      execute: async () => {
        requestCreate(context.invokingOid);
        return { _tag: "Executed" };
      },
    }),
  };
}
