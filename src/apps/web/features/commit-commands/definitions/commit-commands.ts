import type {
  GraphCommandDefinition,
  GraphCommandHandlers,
} from "#web/features/commit-commands/graph-command.contract";

export function createOpenDetailsCommand(
  open: GraphCommandHandlers["openDetails"],
) {
  return {
    id: "graph.openDetails",
    group: "Commit",
    order: -1,
    placement: "commit-menu",
    resolve: (context) => {
      const oid = context.invokingOid;
      if (oid === undefined || open === undefined) {
        return undefined;
      }
      return {
        label: "Open details",
        enabled:
          context.connected && context.capabilities.has("repository.read"),
        execute: async () => {
          open(oid);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}

export function createCopyShaCommand(
  writeClipboard: GraphCommandHandlers["writeClipboard"],
) {
  return {
    id: "graph.copySha",
    group: "Commit",
    order: 0,
    placement: "commit-menu",
    resolve: (context) => {
      const oid = context.invokingOid;
      if (oid === undefined) {
        return undefined;
      }
      return {
        label: "Copy commit SHA",
        enabled: true,
        execute: async () => {
          await writeClipboard(oid);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}

export function createCopySubjectCommand({
  readCommit,
  writeClipboard,
}: Pick<GraphCommandHandlers, "readCommit" | "writeClipboard">) {
  return {
    id: "graph.copySubject",
    group: "Commit",
    order: 1,
    placement: "commit-menu",
    resolve: (context) => {
      const oid = context.invokingOid;
      if (oid === undefined) {
        return undefined;
      }
      return {
        label: "Copy commit subject",
        enabled: true,
        execute: async () => {
          const commit = await readCommit(oid);
          if (commit === undefined) {
            return {
              _tag: "Unavailable",
              reason: "Commit metadata is not available yet",
            };
          }
          await writeClipboard(commit.subject);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}
