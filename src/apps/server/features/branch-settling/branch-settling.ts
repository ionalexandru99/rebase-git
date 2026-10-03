import { Array as Arrays, Cause, Effect } from "effect";
import {
  type BranchSettings,
  BranchSettlingApi,
  defaultDeleteSettledAfter,
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
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import {
  deleteSettledBranches,
  settledLongEnough,
} from "#server/features/branch-settling/settled-branch-deletion.ts";
import { listPullRequests } from "#server/features/pull-requests/pull-requests.ts";
import type { AfterFetch } from "#server/features/repository-pull/repository-fetch.ts";
import { branchRef } from "#server/features/repository-refs/git/branches/branch-git.ts";
import { branchSettlements } from "#server/features/repository-refs/git/read-repository-refs.ts";
import type { HostedPullRequest } from "#server/features/source-control/git-host.ts";
import type { SourceControl } from "#server/features/source-control/source-control.ts";
import {
  type RepositoryAccess,
  readWorktrees,
} from "#server/repository/repository-access.ts";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

const autoSettleKey = "rebase.autoSettle";
const settledPerLock = 20;
const ancestryChecks = 8;
const commitPrefix = /^[0-9a-f]{7,64}$/;
const deleteSettledAfterKey = "rebase.deleteSettledAfter";

const settlePolicy: RepositoryWritePolicy = {
  name: "settle",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

const unlockedSettlePolicy: RepositoryWritePolicy = {
  name: "settle",
  locks: {},
  duringOperation: "proceed",
};

export function branchSettlingFeature(
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
  },
) {
  const { command, query } = repositoryRoutes(dependencies);
  const { coordination, events } = dependencies;
  const publishRefs = (repositoryId: string) =>
    Effect.sync(() => events.publishChanged([repositoryId], "Refs"));
  return {
    routes: [
      command(
        BranchSettlingApi.settle,
        unlockedSettlePolicy,
        ({ names, repositoryId, settled, worktreePath }, git) =>
          writeSettlements(
            git,
            coordination,
            worktreePath,
            names,
            settled ? settledToday() : "false",
          ).pipe(
            Effect.tap(() => publishRefs(repositoryId)),
            Effect.as({}),
          ),
      ),
      query(BranchSettlingApi.settings, ({ worktreePath }, git) =>
        readBranchSettings(git, worktreePath),
      ),
      command(
        BranchSettlingApi.saveSettings,
        settlePolicy,
        ({ autoSettle, deleteSettledAfter, repositoryId, worktreePath }, git) =>
          Effect.forEach(
            [
              [autoSettleKey, String(autoSettle)],
              [deleteSettledAfterKey, String(deleteSettledAfter)],
            ],
            (setting) =>
              runRepositoryGit(git, worktreePath, [
                "config",
                "--local",
                ...setting,
              ]),
            { discard: true },
          ).pipe(
            Effect.andThen(readBranchSettings(git, worktreePath)),
            Effect.tap(() => publishRefs(repositoryId)),
          ),
      ),
    ],
  } satisfies EnvironmentFeature;
}

export function settleBranchesAfterFetch({
  access,
  coordination,
  events,
  git,
  sourceControl,
}: {
  readonly access: RepositoryAccess;
  readonly coordination: RepositoryCoordination;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
  readonly sourceControl: SourceControl;
}): AfterFetch {
  return (directory, repositoryIds) =>
    Effect.gen(function* () {
      const config = yield* readSettlingConfig(git, directory);
      const { autoSettle, deleteSettledAfter } = branchSettings(config);
      const marked = branchSettlements(config);
      const main = (yield* readWorktrees(git, directory)).find(
        (worktree) => worktree.main,
      )?.head.branch;
      const today = settledToday();
      const expired = new Set(
        [...marked].flatMap(([branch, settled]) =>
          branch !== main &&
          settledLongEnough(settled, today, deleteSettledAfter)
            ? [branch]
            : [],
        ),
      );
      if (!autoSettle && expired.size === 0) return;
      const defaults = yield* readRemoteDefaultBranches(git, directory);
      const pullRequests = new Map(
        (yield* listPullRequests(
          git,
          sourceControl,
          directory,
          ({ branch, head, remote }) =>
            expired.has(branch) ||
            (autoSettle &&
              branch !== main &&
              !marked.has(branch) &&
              defaults.get(remote) !== head),
        ).pipe(Effect.catch(() => Effect.succeed([])))).map(
          ({ branch, pullRequests }) => [branch, pullRequests] as const,
        ),
      );
      const merged = yield* mergedAtHead(
        git,
        directory,
        new Map(
          [...pullRequests].filter(
            ([branch, found]) => !marked.has(branch) && isMerged(found),
          ),
        ),
      );
      if (merged.length > 0)
        yield* writeSettlements(git, coordination, directory, merged, today);
      const deleted =
        expired.size > 0 &&
        (yield* coordination
          .run(
            directory,
            settlePolicy,
            deleteSettledBranches(
              git,
              access,
              directory,
              [...expired],
              pullRequests,
            ),
          )
          .pipe(Effect.catch(() => Effect.succeed(true))));
      if (merged.length > 0 || deleted)
        events.publishChanged(repositoryIds, "Refs");
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.failCause(Cause.interrupt())
          : Effect.void,
      ),
    );
}

function readSettlingConfig(
  git: GitCommandRunner,
  directory: string,
  pattern = "^(rebase\\.(autosettle|deletesettledafter)|branch\\..*\\.rebasesettled)$",
) {
  return runRepositoryGit(
    git,
    directory,
    ["config", "--local", "--get-regexp", pattern],
    { exitCodes: [0, 1], maxOutputBytes: 4 * 1_048_576 },
  );
}

export function mergedAtHead(
  git: GitCommandRunner,
  directory: string,
  branches: ReadonlyMap<string, readonly HostedPullRequest[]>,
) {
  return Effect.gen(function* () {
    if (branches.size === 0) return [];
    const tips = yield* readBranchTips(git, directory);
    const merged = yield* Effect.filter(
      [...branches],
      ([name, pullRequests]) => {
        const tip = tips.get(name);
        const heads = mergedHeads(pullRequests);
        if (tip === undefined || heads.length === 0)
          return Effect.succeed(false);
        if (heads.some((head) => tip.startsWith(head)))
          return Effect.succeed(true);
        return Effect.forEach(heads, (head) =>
          runRepositoryGitOutput(
            git,
            directory,
            ["merge-base", "--is-ancestor", tip, head],
            { exitCodes: [0, 1, 128] },
          ),
        ).pipe(
          Effect.map((checks) => checks.some(({ exitCode }) => exitCode === 0)),
        );
      },
      { concurrency: ancestryChecks },
    );
    return merged.map(([name]) => name);
  });
}

function mergedHeads(pullRequests: readonly HostedPullRequest[]) {
  return pullRequests.flatMap(({ headCommit, state }) => {
    const head = headCommit?.toLowerCase();
    return state === "Merged" && head !== undefined && commitPrefix.test(head)
      ? [head]
      : [];
  });
}

function readBranchTips(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname:lstrip=2)%00%(objectname)",
      "refs/heads",
    ],
    { maxOutputBytes: 16 * 1_048_576 },
  ).pipe(Effect.map((output) => new Map(nulPairs(output))));
}

function readRemoteDefaultBranches(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "for-each-ref",
    "--format=%(refname:lstrip=2)%00%(symref:lstrip=2)",
    "refs/remotes/**/HEAD",
  ]).pipe(
    Effect.map(
      (output) =>
        new Map(
          nulPairs(output).flatMap(([name, target]) => {
            const remote = name.slice(0, -"/HEAD".length);
            return name.endsWith("/HEAD") && target.startsWith(`${remote}/`)
              ? [[remote, target.slice(remote.length + 1)] as const]
              : [];
          }),
        ),
    ),
  );
}

function nulPairs(output: string) {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = "", value = ""] = line.split("\0");
      return [name, value] as const;
    });
}

function branchSettings(config: string): BranchSettings {
  const days = lastValue(config, deleteSettledAfterKey.toLowerCase());
  const parsed = Number(days);
  return {
    autoSettle: isOn(lastValue(config, autoSettleKey.toLowerCase())),
    deleteSettledAfter:
      days === ""
        ? defaultDeleteSettledAfter
        : /^\d+$/.test(days) && parsed <= 365
          ? parsed
          : 0,
  };
}

function readBranchSettings(git: GitCommandRunner, directory: string) {
  return readSettlingConfig(
    git,
    directory,
    "^rebase\\.(autosettle|deletesettledafter)$",
  ).pipe(Effect.map(branchSettings));
}

function writeSettlements(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  directory: string,
  names: readonly string[],
  value: string,
) {
  return Effect.forEach(
    Arrays.chunksOf(names, settledPerLock),
    (group) =>
      coordination.run(
        directory,
        settlePolicy,
        Effect.gen(function* () {
          const existing = new Set(
            (yield* runRepositoryGit(git, directory, [
              "for-each-ref",
              "--format=%(refname:lstrip=2)",
              ...group.map(branchRef),
            ])).split("\n"),
          );
          yield* Effect.forEach(
            group.filter((name) => existing.has(name)),
            (name) =>
              runRepositoryGit(git, directory, [
                "config",
                "--local",
                `branch.${name}.rebaseSettled`,
                value,
              ]),
            { discard: true },
          );
        }),
      ),
    { discard: true },
  );
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
