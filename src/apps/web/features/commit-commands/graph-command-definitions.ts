import { createBranchHereCommand } from "#web/features/commit-commands/definitions/branch-commands";
import {
  createCopyShaCommand,
  createCopySubjectCommand,
  createOpenDetailsCommand,
} from "#web/features/commit-commands/definitions/commit-commands";
import { createFetchCommand } from "#web/features/commit-commands/definitions/fetch-command";
import { createPullCommand } from "#web/features/commit-commands/definitions/pull-command";
import type { GraphCommandHandlers } from "#web/features/commit-commands/graph-command.contract";

export function createGraphCommandDefinitions(handlers: GraphCommandHandlers) {
  return [
    createOpenDetailsCommand(handlers.openDetails),
    createCopyShaCommand(handlers.writeClipboard),
    createCopySubjectCommand(handlers),
    createBranchHereCommand(handlers.createBranch),
    createFetchCommand(handlers.fetch),
    createPullCommand(handlers.pull),
  ] as const;
}

export type GraphCommandId = ReturnType<
  typeof createGraphCommandDefinitions
>[number]["id"];
