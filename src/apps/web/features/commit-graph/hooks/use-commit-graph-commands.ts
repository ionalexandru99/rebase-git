import { useMemo } from "react";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text";
import type {
  CommitCommandHandlers,
  GraphCommandContext,
  GraphCommandDefinition,
} from "#web/features/commit-commands/graph-command.contract";
import { useGraphCommands } from "#web/features/commit-commands/use-graph-commands";
import type { RepositoryHistoryReadModel } from "#web/features/repository-history/repository-history-reader.contract";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export function useCommitGraphCommands({
  contributed,
  reader,
  selectedOids,
  onOpenDetails,
}: {
  readonly contributed: readonly GraphCommandDefinition[] | undefined;
  readonly onOpenDetails?: ((oid: string) => void) | undefined;
  readonly reader:
    | Pick<RepositoryHistoryReadModel, "getCommitSummaries">
    | undefined;
  readonly selectedOids: readonly string[];
}) {
  const scope = useRepositoryScope();
  const handlers = useMemo(
    (): CommitCommandHandlers => ({
      ...(onOpenDetails === undefined ? {} : { openDetails: onOpenDetails }),
      readCommit: async (oid) => (await reader?.getCommitSummaries([oid]))?.[0],
      writeClipboard: writeClipboardText,
    }),
    [onOpenDetails, reader],
  );
  const commands = useGraphCommands(handlers, contributed);
  const context = (invokingOid: string): GraphCommandContext => ({
    invokingOid,
    selectedOids,
    connected: scope?.connected ?? false,
    readable: scope?.readable ?? false,
    writable: scope?.writable ?? false,
  });
  return { ...commands, context };
}
