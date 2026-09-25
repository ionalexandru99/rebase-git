import { useMemo } from "react";
import { writeClipboardText } from "#web/features/clipboard/index";
import {
  type CommitCommandHandlers,
  type GraphCommandContext,
  useGraphCommands,
} from "#web/features/commit-commands/index";
import type { RepositoryHistoryReadModel } from "#web/features/repository-history/index";
import { useRepositoryScope } from "#web/features/repository-scope/index";

export function useCommitGraphCommands({
  reader,
  selectedOids,
  onOpenDetails,
}: {
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
  const commands = useGraphCommands(handlers);
  const context = (invokingOid: string): GraphCommandContext => ({
    invokingOid,
    selectedOids,
    connected: scope?.connected ?? false,
    readable: scope?.readable ?? false,
    writable: scope?.writable ?? false,
  });
  return { ...commands, context };
}
