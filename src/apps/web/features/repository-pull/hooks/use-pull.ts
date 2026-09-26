import { type PullBranch, RepositoryPullHttpApi } from "@rebase/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistoryObservation,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/index";
import { createPullBranchCommand } from "#web/features/repository-pull/pull-branch-command";
import { describePullFailure } from "#web/features/repository-pull/repository-pull-messages";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useCommand } from "#web/platform/query/use-command";
import { createStore } from "#web/platform/store/store";
import { useStore } from "#web/platform/store/use-store";

type PullReader = Pick<RepositoryHistoryFetchCommands, "fetch"> &
  RepositoryHistoryObservation;

interface PullAttempt {
  readonly id: number;
  readonly fetching: boolean;
  readonly fetchFailed: boolean;
}

const idleHistory = createStore<RepositoryHistorySnapshot>({
  revision: 0,
  historyRevision: 0,
  status: "empty",
});

export function usePull(reader: PullReader | undefined) {
  const scope = useRepositoryScope();
  const command = useCommand(RepositoryPullHttpApi.pull);
  const [attempt, setAttempt] = useState<PullAttempt>();
  const running = useRef(false);
  const attempts = useRef(0);
  const freshnessReady = useStore(reader ?? idleHistory, isFreshnessReady);
  const repositoryId = scope?.repositoryId;
  const worktreePath = scope?.worktreePath;
  const { mutate, reset } = command;

  const pull = useCallback(
    (branch: string) => {
      if (
        repositoryId === undefined ||
        worktreePath === undefined ||
        reader === undefined ||
        running.current
      )
        return;
      running.current = true;
      const id = ++attempts.current;
      const settle = (fetchFailed: boolean) => {
        running.current = false;
        setAttempt({ id, fetching: false, fetchFailed });
      };
      reset();
      setAttempt({ id, fetching: true, fetchFailed: false });
      void reader.fetch().then(
        (freshness) => {
          if (freshness.failure !== undefined) return settle(false);
          setAttempt({ id, fetching: false, fetchFailed: false });
          const request: PullBranch = { repositoryId, worktreePath, branch };
          mutate(request, {
            onSettled: () => {
              running.current = false;
            },
          });
        },
        () => settle(true),
      );
    },
    [repositoryId, worktreePath, reader, mutate, reset],
  );

  const pulling = attempt?.fetching === true || command.isPending;
  const allowed =
    scope?.connected === true && scope.writable && reader !== undefined;
  const commands = useMemo(
    () => (allowed ? [createPullBranchCommand(pull, pulling)] : []),
    [allowed, pull, pulling],
  );
  const failedBranch = command.isError ? command.variables?.branch : undefined;
  const error =
    attempt === undefined
      ? undefined
      : attempt.fetchFailed
        ? { id: attempt.id, message: "Pull failed" }
        : failedBranch !== undefined && command.error !== null
          ? {
              id: attempt.id,
              message: describePullFailure(failedBranch, command.error),
            }
          : undefined;

  return {
    available: scope !== undefined && reader !== undefined,
    pull,
    pulling,
    freshnessReady,
    error,
    commands,
  };
}

export type Pull = ReturnType<typeof usePull>;

function isFreshnessReady(snapshot: RepositoryHistorySnapshot) {
  return (
    snapshot.freshness !== undefined && snapshot.freshnessError === undefined
  );
}
