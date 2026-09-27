import { RepositoryPullHttpApi } from "@rebase/contracts";
import { useCallback, useMemo } from "react";
import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistoryObservation,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader";
import { createPullBranchCommand } from "#web/features/repository-pull/pull-branch-command";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";
import {
  type CommandFailure,
  useCommand,
} from "#web/platform/query/use-command";
import { createStore } from "#web/platform/store/store";
import { useStore } from "#web/platform/store/use-store";

type PullReader = Pick<RepositoryHistoryFetchCommands, "fetch"> &
  RepositoryHistoryObservation;

const idleHistory = createStore<RepositoryHistorySnapshot>({
  revision: 0,
  historyRevision: 0,
  status: "empty",
});

export function usePull(reader: PullReader | undefined) {
  const scope = useRepositoryScope();
  const command = useCommand(RepositoryPullHttpApi.pull, {
    before: async () =>
      reader !== undefined && (await reader.fetch()).failure === undefined,
  });
  const freshnessReady = useStore(reader ?? idleHistory, isFreshnessReady);
  const pulling = command.running;
  const { run, canRun } = command;

  const pull = useCallback(
    async (branch: string) => {
      if (!canRun || reader === undefined || pulling) return;
      await run({ branch });
    },
    [canRun, reader, pulling, run],
  );

  const allowed = canRun && reader !== undefined;
  const commands = useMemo(
    () =>
      allowed
        ? [createPullBranchCommand((branch) => void pull(branch), pulling)]
        : [],
    [allowed, pull, pulling],
  );

  return {
    available: scope !== undefined && reader !== undefined,
    canRun,
    pull,
    pulling,
    freshnessReady,
    error:
      command.failure === undefined ||
      command.failure._tag === "Cancelled" ||
      command.input === undefined
        ? undefined
        : describePullFailure(command.input.branch, command.failure),
    commands,
  };
}

export type Pull = ReturnType<typeof usePull>;

function isFreshnessReady(snapshot: RepositoryHistorySnapshot) {
  return (
    snapshot.freshness !== undefined && snapshot.freshnessError === undefined
  );
}

function describePullFailure(
  branch: string,
  failure: CommandFailure<typeof RepositoryPullHttpApi.pull>,
) {
  return describeFailure(failure, {
    PullDiverged: ({ upstream }) => `${branch} has diverged from ${upstream}.`,
    PullWouldOverwrite: ({ paths }) =>
      paths.length === 1
        ? `Local changes to ${paths[0]} block the pull.`
        : "Local changes block the pull.",
    UpstreamMissing: ({ upstream }) =>
      upstream === undefined
        ? `${branch} has no upstream.`
        : `${upstream} was deleted.`,
    PullUncertain: () => "Pull may not have finished.",
    BranchMissing: () => `${branch} no longer exists.`,
  });
}
