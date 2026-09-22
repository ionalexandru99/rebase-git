import type {
  GraphCommandDefinition,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";

export function createToggleHistoryRefCommand(
  toggle: GraphCommandHandlers["toggleHistoryRef"],
) {
  return {
    id: "history.toggleRef",
    group: "History scope",
    order: 10,
    placement: "ref-menu",
    resolve: (context) => {
      const ref = context.ref;
      if (ref === undefined || toggle === undefined) {
        return undefined;
      }
      return {
        label: ref.included ? "Remove from history" : "Add to history",
        enabled: true,
        execute: async () => {
          await toggle(ref.target, context);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}
