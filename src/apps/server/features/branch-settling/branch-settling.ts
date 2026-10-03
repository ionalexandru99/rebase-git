import { Cause, Effect } from "effect";
import {
  type BranchSettings,
  BranchSettlingApi,
} from "#contracts/branch-settling/branch-settling.contract.ts";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { listPullRequests } from "#server/features/pull-requests/pull-requests.ts";
import type { AfterFetch } from "#server/features/repository-pull/repository-fetch.ts";
import { branchSettlements } from "#server/features/repository-refs/git/read-repository-refs.ts";
import type { SourceControl } from "#server/features/source-control/source-control.ts";
import { readWorktrees } from "#server/repository/repository-access.ts";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

const autoSettleKey = "rebase.autoSettle";

const settlePolicy: RepositoryWritePolicy = {
  name: "settle",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

export function branchSettlingFeature(
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
  },
) {
  const { command, query } = repositoryRoutes(dependencies);
  return {
    routes: [
      command(
        BranchSettlingApi.settle,
        settlePolicy,
        ({ names, repositoryId, settled, worktreePath }, git) =>
          writeSettlements(
            git,
            worktreePath,
            names,
            settled ? settledToday() : "false",
          ).pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                dependencies.events.publishChanged([repositoryId], "Refs"),
              ),
            ),
            Effect.as({}),
          ),
      ),
      query(BranchSettlingApi.settings, ({ worktreePath }, git) =>
        readBranchSettings(git, worktreePath),
      ),
      command(
        BranchSettlingApi.saveSettings,
        settlePolicy,
        ({ autoSettle, worktreePath }, git) =>
          runRepositoryGit(git, worktreePath, [
            "config",
            "--local",
            autoSettleKey,
            String(autoSettle),
          ]).pipe(Effect.andThen(readBranchSettings(git, worktreePath))),
      ),
    ],
  } satisfies EnvironmentFeature;
}

export function settleMergedBranches({
  coordination,
  events,
  git,
  sourceControl,
}: {
  readonly coordination: RepositoryCoordination;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
  readonly sourceControl: SourceControl;
}): AfterFetch {
  return (directory, repositoryIds) =>
    Effect.gen(function* () {
      const config = yield* runRepositoryGit(
        git,
        directory,
        [
          "config",
          "--local",
          "--get-regexp",
          "^(rebase\\.autosettle|branch\\..*\\.rebasesettled)$",
        ],
        { exitCodes: [0, 1], maxOutputBytes: 4 * 1_048_576 },
      );
      if (!isOn(lastValue(config, autoSettleKey.toLowerCase()))) return;
      const marked = branchSettlements(config);
      const main = (yield* readWorktrees(git, directory)).find(
        (worktree) => worktree.main,
      )?.head.branch;
      const merged = (yield* listPullRequests(
        git,
        sourceControl,
        directory,
        (branch) => branch !== main && !marked.has(branch),
      )).flatMap(({ branch, pullRequests }) =>
        isMerged(pullRequests) ? [branch] : [],
      );
      if (merged.length === 0) return;
      yield* coordination.run(
        directory,
        settlePolicy,
        writeSettlements(git, directory, merged, settledToday()),
      );
      events.publishChanged(repositoryIds, "Refs");
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.failCause(Cause.interrupt())
          : Effect.void,
      ),
    );
}

function readBranchSettings(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["config", "--local", "--get", autoSettleKey],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.map((value): BranchSettings => ({ autoSettle: isOn(value.trim()) })),
  );
}

function writeSettlements(
  git: GitCommandRunner,
  directory: string,
  names: readonly string[],
  value: string,
) {
  return Effect.gen(function* () {
    const existing = new Set(
      (yield* runRepositoryGit(
        git,
        directory,
        ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"],
        { maxOutputBytes: 16 * 1_048_576 },
      )).split("\n"),
    );
    yield* Effect.forEach(
      names.filter((name) => existing.has(name)),
      (name) =>
        runRepositoryGit(git, directory, [
          "config",
          "--local",
          `branch.${name}.rebaseSettled`,
          value,
        ]),
      { discard: true },
    );
  });
}

function isMerged(pullRequests: readonly PullRequest[]) {
  return (
    pullRequests.some(({ state }) => state === "Merged") &&
    !pullRequests.some(({ state }) => state === "Open" || state === "Draft")
  );
}

function lastValue(config: string, key: string) {
  const prefix = `${key} `;
  return (
    config
      .split("\n")
      .findLast((line) => line === key || line.startsWith(prefix))
      ?.slice(prefix.length) ?? ""
  );
}

function isOn(value: string) {
  return !/^(false|no|off|0)$/i.test(value);
}

function settledToday() {
  const today = new Date();
  return [
    String(today.getFullYear()).padStart(4, "0"),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}
