import { skipToken } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import {
  type CommandFailure,
  useCommand,
} from "#web/platform/query/use-command.ts";

export function useFetch() {
  const scope = useRepositoryScope();
  const repositoryId = scope?.repositoryId;
  const status = useEnvironmentQuery(
    RepositoryPullApi.fetchStatus,
    repositoryId === undefined ? skipToken : { repositoryId },
    { changes: "refs" },
  );
  const command = useCommand(RepositoryPullApi.fetch);
  const { run } = command;
  const execute = useCallback(
    () =>
      repositoryId === undefined
        ? Promise.resolve(false)
        : run({ repositoryId }).then((result) => result._tag === "Ok"),
    [repositoryId, run],
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
  const [mountedAt] = useState(Date.now);
  const pulling = command.running;
  const { run, canRun } = command;

  const pull = useCallback(
    async (branch: string) => {
      if (!canRun || pulling) return;
      await run({ branch });
    },
    [canRun, pulling, run],
  );

  const latest = command.latest;
  return {
    available: scope !== undefined,
    allowed: canRun,
    canRun,
    pull,
    pulling,
    ready: fetch.ready,
    error:
      latest?.result === undefined ||
      latest.submittedAt < mountedAt ||
      latest.result._tag === "Ok" ||
      latest.result._tag === "Cancelled" ||
      latest.input === undefined
        ? undefined
        : describePullFailure(latest.input.branch, latest.result),
  };
}

export type Pull = ReturnType<typeof usePull>;

function describePullFailure(
  branch: string,
  failure: CommandFailure<typeof RepositoryPullApi.pull>,
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
