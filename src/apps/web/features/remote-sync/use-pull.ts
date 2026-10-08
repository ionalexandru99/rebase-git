import { skipToken } from "@tanstack/react-query";
import type { RouteFailure } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type DivergedPull,
  type FetchFailed,
  type PullBranch,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { fileName } from "#web/features/file-diff/components/file-row-name.tsx";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import { useStashCommands } from "#web/features/stashes/stashes.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  type FailureMessages,
  rejection,
} from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

const fetchProblems: Record<FetchFailed["reason"], string> = {
  GitUnavailable: "Git could not start on the server.",
  Timeout: "The remote took too long to answer.",
  OutputTooLarge: "Git returned more output than Rebase can read.",
  Failed: "Git could not fetch from the remote.",
};

export function useFetch(toast: "fetch" | "pull" = "fetch") {
  const scope = useRepositoryScope();
  const repositoryId = scope?.repositoryId;
  const status = useEnvironmentQuery(
    RepositoryPullApi.fetchStatus,
    repositoryId === undefined ? skipToken : { repositoryId },
    { changes: "refs" },
  );
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const command = useCommand(RepositoryPullApi.fetch, {
    progress: (percent) => statusToast.advance(toast, percent),
  });
  const { run } = command;
  const execute = () =>
    repositoryId === undefined
      ? Promise.resolve(false)
      : run({ repositoryId }).then((result) => {
          errorToast.failure("fetch", result, {
            FetchFailed: ({ reason }) => fetchProblems[reason],
          });
          return result._tag === "Ok";
        });
  const fetchNow = () => {
    statusToast.progress(toast, "Fetching", { percent: 0 });
    void execute().then((fetched) => {
      if (fetched) statusToast.success(toast, "Fetched");
    });
  };
  return {
    status: status.data,
    ready: status.data !== undefined && scope?.connected === true,
    fetching: status.data?.fetching === true || command.running,
    failed:
      command.failure !== undefined ||
      (status.data?.failure !== undefined && !command.running),
    execute,
    fetchNow,
  };
}

export type Fetch = ReturnType<typeof useFetch>;

export function usePull() {
  const scope = useRepositoryScope();
  const fetch = useFetch("pull");
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const stashes = useStashCommands();
  const command = useCommand(RepositoryPullApi.pull, {
    before: async ({ strategy }) => {
      const fetched = await fetch.execute();
      if (fetched)
        statusToast.progress(
          "pull",
          strategy === undefined ? "Pulling" : integrationSteps[strategy.kind],
          { percent: 0 },
        );
      return fetched;
    },
    progress: (percent) => statusToast.advance("pull", percent),
    answers: (value, input) =>
      value.outcome === "Stopped" && value.worktreePath === input.worktreePath
        ? [
            answer(
              RepositoryOperationsApi.read,
              {
                repositoryId: input.repositoryId,
                worktreePath: input.worktreePath,
              },
              value.operation,
            ),
          ]
        : [],
  });
  const pulling = command.running;
  const { run, canRun } = command;
  const worktreePath = scope?.worktreePath;

  const pull = async (branch: string, strategy?: PullChoice) => {
    if (!canRun || pulling) return;
    statusToast.progress("pull", "Fetching", { percent: 0 });
    const result = await run({
      branch,
      ...(strategy === undefined ? {} : { strategy }),
    });
    const failure = result._tag === "Ok" ? undefined : rejection(result);
    if (failure?._tag === "PullDiverged") {
      const choice = (kind: PullChoice["kind"], label: string) => ({
        label,
        run: () =>
          void pull(branch, { kind, upstream: failure.upstreamCommit }),
      });
      statusToast.choose("pull", "Branch has diverged", [
        choice("rebase", "Rebase"),
        choice("merge", "Merge"),
      ]);
    } else if (failure?._tag === "PullStashKept")
      errorToast.show(
        "pull",
        `${failure.busy ? "Another Git operation is running." : "Git stopped before pulling."}\nYour changes are in Stashes.`,
        {
          label: "Apply",
          run: () =>
            void stashes.restore(
              { oid: failure.stash, name: "autostash" },
              false,
              true,
              "Your changes are back",
            ),
        },
      );
    else if (result._tag !== "Ok")
      errorToast.failure("pull", result, pullFailureMessages);
    else if (result.value.outcome === "Stopped") {
      if (result.value.worktreePath === worktreePath) statusToast.close("pull");
      else
        errorToast.show("pull", "Resolve the conflicts in the other worktree.");
    } else if (result.value.stashKept)
      statusToast.warning(
        "pull",
        "Pulled, but your changes conflict",
        "A copy is saved in Stashes.",
      );
    else statusToast.success("pull", pulledTitles[result.value.outcome]);
  };

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

type PullChoice = NonNullable<PullBranch["strategy"]>;

const integrationSteps: Record<DivergedPull, string> = {
  rebase: "Rebasing",
  merge: "Merging",
};

const pulledTitles = {
  UpToDate: "Already up to date",
  FastForwarded: "Pulled",
  Rebased: "Pulled and rebased",
  Merged: "Pulled and merged",
} as const;

const pullFailureMessages: FailureMessages<
  RouteFailure<typeof RepositoryPullApi.pull>
> = {
  PullWouldOverwrite: ({ paths }) =>
    paths.length === 1
      ? `Untracked ${fileName(paths[0] ?? "")} is in the way.`
      : "Untracked files are in the way.",
  UpstreamMissing: ({ upstream }) =>
    upstream === undefined
      ? "No upstream branch."
      : "The remote branch was deleted.",
  UpstreamMoved: () => "The remote branch moved.",
  BranchMissing: () => "The branch no longer exists.",
};
