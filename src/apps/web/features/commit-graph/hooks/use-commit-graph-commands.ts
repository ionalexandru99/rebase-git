import { useMemo } from "react";
import { writeClipboardText } from "#web/features/clipboard/index";
import type {
  GraphCommandEnvironment,
  GraphCommandHandlers,
} from "#web/features/commit-commands/index";
import { useGraphCommands } from "#web/features/commit-commands/index";
import type {
  RepositoryHistoryReadModel,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/index";

export function useCommitGraphCommands({
  commandEnvironment,
  reader,
  historySnapshot,
  fetch,
  selectedOids,
  onOpenDetails,
}: {
  readonly onOpenDetails?: ((oid: string) => void) | undefined;
  readonly commandEnvironment: GraphCommandEnvironment | undefined;
  readonly reader:
    | Pick<RepositoryHistoryReadModel, "getCommitSummaries">
    | undefined;
  readonly historySnapshot: Pick<
    RepositoryHistorySnapshot,
    "freshness" | "freshnessError"
  >;
  readonly fetch: { readonly fetching: boolean; readonly execute: () => void };
  readonly selectedOids: readonly string[];
}) {
  const handlers = useMemo(
    (): GraphCommandHandlers => ({
      ...(onOpenDetails === undefined ? {} : { openDetails: onOpenDetails }),
      readCommit: async (oid) => (await reader?.getCommitSummaries([oid]))?.[0],
      writeClipboard: writeClipboardText,
      ...(reader === undefined ? {} : { fetch: fetch.execute }),
    }),
    [onOpenDetails, reader, fetch.execute],
  );
  const commands = useGraphCommands({
    environment:
      commandEnvironment === undefined
        ? undefined
        : {
            ...commandEnvironment,
            freshnessReady:
              historySnapshot.freshness !== undefined &&
              historySnapshot.freshnessError === undefined,
            operationState: fetch.fetching
              ? "fetching"
              : commandEnvironment.operationState,
          },
    selectedOids,
    handlers,
  });
  const fetchContext = commands.context();
  const fetchCommand =
    fetchContext === undefined
      ? undefined
      : commands.registry.describe("graph.fetch", fetchContext);
  const fetchAction = {
    execute: () => {
      void commands.execute("graph.fetch", commands.context());
    },
    disabled: fetchCommand?.enabled !== true,
  };
  return { commands, fetchAction };
}
