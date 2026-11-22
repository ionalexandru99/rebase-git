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
const settledPerLock = 20;
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
  return {
    routes: [
      command(
        BranchSettlingApi.settle,
        unlockedSettlePolicy,
        async ({ names, repositoryId, settled, worktreePath }, git) => {
          await writeSettlements(
            git,
            coordination,
            worktreePath,
            names,
            settled ? settledToday() : "false",
          );
          events.publishChanged([repositoryId], "Refs");
          return {};
        },
      ),
      query(BranchSettlingApi.settings, ({ worktreePath }, git) =>
        readBranchSettings(git, worktreePath),
      ),
      command(
        BranchSettlingApi.saveSettings,
        settlePolicy,
        async (
          { autoSettle, deleteSettledAfter, repositoryId, worktreePath },
          git,
        ) => {
          for (const setting of [
            [autoSettleKey, String(autoSettle)],
            [deleteSettledAfterKey, String(deleteSettledAfter)],
          ])
            await runRepositoryGit(git, worktreePath, [
              "config",
              "--local",
              ...setting,
            ]);
          const settings = await readBranchSettings(git, worktreePath);
          events.publishChanged([repositoryId], "Refs");
          return settings;
        },
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

async function readBranchSettings(git: GitCommandRunner, directory: string) {
  return branchSettings(
    await readSettlingConfig(
      git,
      directory,
      "^rebase\\.(autosettle|deletesettledafter)$",
    ),
  );
}

export async function writeSettlements(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  directory: string,
  names: readonly string[],
  value: string,
) {
  for (const group of settledGroups(names))
    await coordination.run(directory, settlePolicy, async () => {
      const existing = new Set(
        (
          await runRepositoryGit(git, directory, [
            "for-each-ref",
            "--format=%(refname:lstrip=2)",
            ...group.map(branchRef),
          ])
        ).split("\n"),
      );
      for (const name of group.filter((name) => existing.has(name)))
        await runRepositoryGit(git, directory, [
          "config",
          "--local",
          `branch.${name}.rebaseSettled`,
          value,
        ]);
    });
}

export function settledGroups<Item>(items: readonly Item[]) {
  return Array.from(
    { length: Math.ceil(items.length / settledPerLock) },
    (_, index) =>
      items.slice(index * settledPerLock, (index + 1) * settledPerLock),
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
