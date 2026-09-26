import { RepositoryPullHttpApi } from "@rebase/contracts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistoryObservation,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader";
import { usePulling } from "#web/features/repository-pull/hooks/use-pulling";
import { createPullBranchCommand } from "#web/features/repository-pull/pull-branch-command";
import { describePullFailure } from "#web/features/repository-pull/repository-pull-messages";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import { commandKey, useCommand } from "#web/platform/query/use-command";
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
  const fetchFirst = useMutation({
    mutationKey: commandKey(RepositoryPullHttpApi.pull, scope),
    mutationFn: (fetcher: PullReader) => fetcher.fetch(),
  });
  const command = useCommand(RepositoryPullHttpApi.pull, { repository: scope });
  const freshnessReady = useStore(reader ?? idleHistory, isFreshnessReady);
  const pulling = usePulling();
  const repositoryId = scope?.repositoryId;
  const worktreePath = scope?.worktreePath;
  const { mutate: fetchBeforePull } = fetchFirst;
  const { mutate: pullBranch, reset } = command;

  const pull = useCallback(
    (branch: string) => {
      if (
        repositoryId === undefined ||
        worktreePath === undefined ||
        reader === undefined ||
        pulling
      )
        return;
      reset();
      fetchBeforePull(reader, {
        onSuccess: (freshness) => {
          if (freshness.failure === undefined)
            pullBranch({ repositoryId, worktreePath, branch });
        },
      });
    },
    [
      repositoryId,
      worktreePath,
      reader,
      pulling,
      reset,
      fetchBeforePull,
      pullBranch,
    ],
  );

  const allowed =
    scope?.connected === true && scope.writable && reader !== undefined;
  const commands = useMemo(
    () => (allowed ? [createPullBranchCommand(pull, pulling)] : []),
    [allowed, pull, pulling],
  );

  return {
    available: scope !== undefined && reader !== undefined,
    pull,
    pulling,
    freshnessReady,
    error: fetchFirst.isError
      ? { id: fetchFirst.submittedAt, message: "Pull failed" }
      : command.error !== null && command.variables !== undefined
        ? {
            id: command.submittedAt,
            message: describePullFailure(
              command.variables.branch,
              command.error,
            ),
          }
        : undefined,
    commands,
  };
}

export type Pull = ReturnType<typeof usePull>;

function isFreshnessReady(snapshot: RepositoryHistorySnapshot) {
  return (
    snapshot.freshness !== undefined && snapshot.freshnessError === undefined
  );
}
