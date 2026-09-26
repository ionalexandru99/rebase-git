import type { RefCommandDefinition } from "#web/features/ref-commands/ref-command";

export function createPullBranchCommand(
  pull: (branch: string) => void,
  pulling: boolean,
): RefCommandDefinition {
  return {
    id: "pull.branch",
    order: 0,
    resolve: ({ target, upstream }) =>
      target._tag !== "LocalBranch" || upstream === undefined
        ? undefined
        : {
            label: "Pull",
            enabled: !pulling,
            execute: async () => {
              pull(target.name);
              return { _tag: "Executed" };
            },
          },
  };
}
