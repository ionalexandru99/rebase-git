import { useMemo } from "react";
import { writeClipboardText } from "#web/features/clipboard/index";
import type {
  GraphCommandEnvironment,
  GraphCommandHandlers,
} from "#web/features/commit-commands/index";
import { useGraphCommands } from "#web/features/commit-commands/index";
import type { CommitGraphPull } from "#web/features/commit-graph/commit-graph.contract";
import type {
  RepositoryHistoryReadModel,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/index";

export function useCommitGraphCommands({
  commandEnvironment,
  onCreateBranch,
  reader,
  historySnapshot,
  fetch,
  pull,
  selectedOids,
  onOpenDetails,
}: {
  readonly onCreateBranch?: ((oid: string) => void) | undefined;
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
  readonly pull: CommitGraphPull | undefined;
  readonly selectedOids: readonly string[];
}) {
  const pullBranch = pull?.execute;
  const handlers = useMemo(
    (): GraphCommandHandlers => ({
      ...(onOpenDetails === undefined ? {} : { openDetails: onOpenDetails }),
      ...(onCreateBranch === undefined ? {} : { createBranch: onCreateBranch }),
      readCommit: async (oid) => (await reader?.getCommitSummaries([oid]))?.[0],
      writeClipboard: writeClipboardText,
      ...(reader === undefined ? {} : { fetch: fetch.execute }),
      ...(pullBranch === undefined ? {} : { pull: pullBranch }),
    }),
    [onCreateBranch, onOpenDetails, reader, fetch.execute, pullBranch],
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
              : pull?.pulling
                ? "busy"
                : commandEnvironment.operationState,
          },
    selectedOids,
    handlers,
  });
  const toolbarContext = commands.context();
  const fetchCommand =
    toolbarContext === undefined
      ? undefined
      : commands.registry.describe("graph.fetch", toolbarContext);
  const fetchAction = {
    execute: () => {
      void commands.execute("graph.fetch", commands.context());
    },
    disabled: fetchCommand?.enabled !== true,
  };
  const pullCommand =
    toolbarContext === undefined
      ? undefined
      : commands.registry.describe("graph.pull", toolbarContext);
  const pullAction =
    pullCommand === undefined
      ? undefined
      : {
          execute: () => {
            void commands.execute("graph.pull", commands.context());
          },
          disabled: !pullCommand.enabled,
        };
  return { commands, fetchAction, pullAction };
}
