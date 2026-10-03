import { Array as Arrays, Effect } from "effect";
import {
  type BranchSettings,
  BranchSettlingApi,
  defaultDeleteSettledAfter,
} from "#contracts/branch-settling/branch-settling.contract.ts";
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
import { branchRef } from "#server/features/repository-refs/git/branches/branch-git.ts";
import type {
  RepositoryCoordination,
  RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";

const autoSettleKey = "rebase.autoSettle";
export const settledPerLock = 20;
const deleteSettledAfterKey = "rebase.deleteSettledAfter";

export const settlePolicy: RepositoryWritePolicy = {
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

export function readSettlingConfig(
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

export function branchSettings(config: string): BranchSettings {
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

export function writeSettlements(
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

export function settledToday() {
  const today = new Date();
  return [
    String(today.getFullYear()).padStart(4, "0"),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}
