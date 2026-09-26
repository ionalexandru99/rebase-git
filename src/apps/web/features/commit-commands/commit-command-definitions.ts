import type {
  CommitCommandHandlers,
  GraphCommandDefinition,
} from "#web/features/commit-commands/graph-command";

export function createCommitCommandDefinitions(
  handlers: CommitCommandHandlers,
) {
  return [
    createOpenDetailsCommand(handlers.openDetails),
    createCopyShaCommand(handlers.writeClipboard),
    createCopySubjectCommand(handlers),
  ] as const;
}

export type CommitCommandId = ReturnType<
  typeof createCommitCommandDefinitions
>[number]["id"];

function createOpenDetailsCommand(open: CommitCommandHandlers["openDetails"]) {
  return {
    id: "graph.openDetails",
    order: -1,
    resolve: (context) => {
      if (open === undefined) {
        return undefined;
      }
      return {
        label: "Open details",
        enabled: context.connected && context.readable,
        execute: async () => {
          open(context.invokingOid);
          return { _tag: "Executed" };
        },
      };
    },
  } as const satisfies GraphCommandDefinition;
}

function createCopyShaCommand(
  writeClipboard: CommitCommandHandlers["writeClipboard"],
) {
  return {
    id: "graph.copySha",
    order: 0,
    resolve: (context) => ({
      label: "Copy commit SHA",
      enabled: true,
      execute: async () => {
        await writeClipboard(context.invokingOid);
        return { _tag: "Executed" };
      },
    }),
  } as const satisfies GraphCommandDefinition;
}

function createCopySubjectCommand({
  readCommit,
  writeClipboard,
}: Pick<CommitCommandHandlers, "readCommit" | "writeClipboard">) {
  return {
    id: "graph.copySubject",
    order: 1,
    resolve: (context) => ({
      label: "Copy commit subject",
      enabled: true,
      execute: async () => {
        const commit = await readCommit(context.invokingOid);
        if (commit === undefined) {
          return {
            _tag: "Unavailable",
            reason: "Commit metadata is not available yet",
          };
        }
        await writeClipboard(commit.subject);
        return { _tag: "Executed" };
      },
    }),
  } as const satisfies GraphCommandDefinition;
}
