import {
  createCopyShaCommand,
  createCopySubjectCommand,
  createOpenDetailsCommand,
} from "#web/features/commit-commands/definitions/commit-commands";
import { createFetchCommand } from "#web/features/commit-commands/definitions/fetch-command";
import { createToggleHistoryRefCommand } from "#web/features/commit-commands/definitions/toggle-history-ref-command";
import type { GraphCommandHandlers } from "#web/features/commit-commands/graph-command.contract";

export function createGraphCommandDefinitions(handlers: GraphCommandHandlers) {
  return [
    createOpenDetailsCommand(handlers.openDetails),
    createCopyShaCommand(handlers.writeClipboard),
    createCopySubjectCommand(handlers),
    createToggleHistoryRefCommand(handlers.toggleHistoryRef),
    createFetchCommand(handlers.fetch),
  ] as const;
}

export type GraphCommandId = ReturnType<
  typeof createGraphCommandDefinitions
>[number]["id"];
