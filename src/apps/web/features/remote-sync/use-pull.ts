import { skipToken } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RouteFailure } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  type FetchFailed,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import type { FailureMessages } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

const fetchProblems: Record<FetchFailed["reason"], string> = {
  GitUnavailable: "Git could not start on the server.",
  Timeout: "The remote took too long to answer.",
  OutputTooLarge: "Git returned more output than Rebase can read.",
  Failed: "Git could not fetch from the remote. Try again.",
};

export function useFetch() {
  const scope = useRepositoryScope();
  const repositoryId = scope?.repositoryId;
  const status = useEnvironmentQuery(
    RepositoryPullApi.fetchStatus,
    repositoryId === undefined ? skipToken : { repositoryId },
    { changes: "refs" },
  );
  const command = useCommand(RepositoryPullApi.fetch);
  const errorToast = useErrorToast();
  const { run } = command;
  const execute = useCallback(
    () =>
      repositoryId === undefined
        ? Promise.resolve(false)
        : run({ repositoryId }).then((result) => {
            errorToast.failure("fetch", result, {
              FetchFailed: ({ reason }) => fetchProblems[reason],
            });
            return result._tag === "Ok";
          }),
    [repositoryId, run, errorToast],
  );
  return {
    status: status.data,
    ready: status.data !== undefined && scope?.connected === true,
    fetching: status.data?.fetching === true || command.running,
    failed:
      command.failure !== undefined ||
      (status.data?.failure !== undefined && !command.running),
    execute,
  };
}

export type Fetch = ReturnType<typeof useFetch>;

export function usePull() {
  const scope = useRepositoryScope();
  const fetch = useFetch();
  const command = useCommand(RepositoryPullApi.pull, { before: fetch.execute });
  const errorToast = useErrorToast();
  const pulling = command.running;
  const { run, canRun } = command;

  const pull = useCallback(
    async (branch: string) => {
      if (!canRun || pulling) return;
      errorToast.failure(
        "pull",
        await run({ branch }),
        pullFailureMessages(branch),
      );
    },
    [canRun, pulling, run, errorToast],
  );

  return {
    available: scope !== undefined,
    allowed: canRun,
    canRun,
    pull,
    pulling,
    ready: fetch.ready,
  };
}

export type Pull = ReturnType<typeof usePull>;

function pullFailureMessages(
  branch: string,
): FailureMessages<RouteFailure<typeof RepositoryPullApi.pull>> {
  return {
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
  };
}
