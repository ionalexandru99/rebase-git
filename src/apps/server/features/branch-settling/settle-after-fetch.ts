import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import {
  branchSettings,
  readSettlingConfig,
  settledToday,
  writeSettlements,
} from "#server/features/branch-settling/branch-settling.ts";
import {
  deleteSettledBranches,
  operationBranches,
  type SettledCandidate,
  settledLongEnough,
} from "#server/features/branch-settling/settled-branch-deletion.ts";
import { listPullRequests } from "#server/features/pull-requests/pull-requests.ts";
import type { AfterFetch } from "#server/features/repository-pull/repository-fetch.ts";
import { branchSettlements } from "#server/features/repository-refs/git/read-repository-refs.ts";
import {
  type HostedPullRequest,
  mapConcurrently,
} from "#server/features/source-control/git-host.ts";
import type { SourceControl } from "#server/features/source-control/source-control.ts";
import {
  type RepositoryAccess,
  readWorktrees,
} from "#server/repository/repository-access.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

const ancestryChecks = 8;
const commitPrefix = /^[0-9a-f]{7,64}$/;

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
  return async (directory, repositoryIds) => {
    try {
      const config = await readSettlingConfig(git, directory);
      const { autoSettle, deleteSettledAfter } = branchSettings(config);
      const marked = branchSettlements(config);
      const main = (await readWorktrees(git, directory)).find(
        (worktree) => worktree.main,
      );
      const kept = await operationBranches(git, directory);
      if (main?.head.branch !== undefined) kept.add(main.head.branch);
      const today = settledToday();
      const expired = new Set(
        [...marked].flatMap(([branch, settled]) =>
          !kept.has(branch) &&
          settledLongEnough(settled, today, deleteSettledAfter)
            ? [branch]
            : [],
        ),
      );
      if (!autoSettle && expired.size === 0) return;
      const pullRequests = new Map(
        (
          await listPullRequests(
            git,
            sourceControl,
            directory,
            ({ branch, default: isDefault }) =>
              !isDefault &&
              (expired.has(branch) ||
                (autoSettle && !kept.has(branch) && !marked.has(branch))),
          )
        )?.branches.map(
          ({ branch, pullRequests }) => [branch, pullRequests] as const,
        ) ?? [],
      );
      const merged = [...pullRequests].flatMap(([branch, found]) =>
        isMerged(found) && !marked.has(branch) ? [branch] : [],
      );
      if (merged.length > 0)
        await writeSettlements(git, coordination, directory, merged, today);
      const locals = await readLocalBranches(git, directory);
      const tips = await mergedTips(
        git,
        directory,
        locals,
        new Map([...pullRequests].filter(([branch]) => expired.has(branch))),
      );
      const candidates = [...expired].flatMap((name) =>
        deletionCandidate(
          name,
          pullRequests.get(name),
          locals.get(name),
          tips.get(name),
        ),
      );
      const deleted =
        candidates.length > 0 &&
        (await deleteSettledBranches(
          git,
          access,
          coordination,
          directory,
          candidates,
        ));
      if (merged.length > 0 || deleted)
        events.publishChanged(repositoryIds, "Refs");
    } catch {}
  };
}

function deletionCandidate(
  name: string,
  pullRequests: readonly HostedPullRequest[] | undefined,
  head: LocalBranchHead | undefined,
  tip: string | undefined,
): SettledCandidate[] {
  if (pullRequests === undefined) return head?.pushed ? [] : [{ name }];
  if (pullRequests.some(({ state }) => state === "Open" || state === "Draft"))
    return [];
  if (tip !== undefined) return [{ name, mergedTip: tip }];
  return mergedHeads(pullRequests).length > 0 ? [] : [{ name }];
}

async function mergedTips(
  git: GitCommandRunner,
  directory: string,
  locals: ReadonlyMap<string, LocalBranchHead>,
  branches: ReadonlyMap<string, readonly HostedPullRequest[]>,
) {
  const merged = await mapConcurrently(
    branches,
    ancestryChecks,
    async ([name, pullRequests]) => {
      const tip = locals.get(name)?.tip;
      const heads = mergedHeads(pullRequests);
      if (tip === undefined || heads.length === 0) return [];
      if (heads.some((head) => tip.startsWith(head)))
        return [[name, tip] as const];
      for (const head of heads) {
        const { exitCode } = await runRepositoryGitOutput(
          git,
          directory,
          ["merge-base", "--is-ancestor", tip, head],
          { exitCodes: [0, 1, 128] },
        );
        if (exitCode === 0) return [[name, tip] as const];
      }
      return [];
    },
  );
  return new Map(merged.flat());
}

function mergedHeads(pullRequests: readonly HostedPullRequest[]) {
  return pullRequests.flatMap(({ headCommit, state }) => {
    const head = headCommit?.toLowerCase();
    return state === "Merged" && head !== undefined && commitPrefix.test(head)
      ? [head]
      : [];
  });
}

function isMerged(pullRequests: readonly PullRequest[]) {
  return (
    pullRequests.some(({ state }) => state === "Merged") &&
    !pullRequests.some(({ state }) => state === "Open" || state === "Draft")
  );
}

interface LocalBranchHead {
  readonly tip: string;
  readonly pushed: boolean;
}

async function readLocalBranches(git: GitCommandRunner, directory: string) {
  const output = await runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(upstream)",
      "refs/heads",
      "refs/remotes",
    ],
    { maxOutputBytes: 16 * 1_048_576 },
  );
  const refs = output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ref = "", tip = "", upstream = ""] = line.split("\0");
      return { ref, tip, upstream };
    });
  const remote = remoteBranchNames(
    refs.flatMap(({ ref }) => (ref.startsWith("refs/remotes/") ? [ref] : [])),
  );
  return new Map(
    refs.flatMap(({ ref, tip, upstream }): [string, LocalBranchHead][] => {
      const name = ref.slice("refs/heads/".length);
      return ref.startsWith("refs/heads/")
        ? [[name, { tip, pushed: upstream !== "" || remote.has(name) }]]
        : [];
    }),
  );
}

function remoteBranchNames(refs: readonly string[]) {
  return new Set(
    refs.flatMap((ref) => {
      const path = ref.split("/").slice(2);
      return path.slice(1).map((_, index) => path.slice(index + 1).join("/"));
    }),
  );
}
