import { Cause, Effect } from "effect";
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
import type { HostedPullRequest } from "#server/features/source-control/git-host.ts";
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
  return (directory, repositoryIds) =>
    Effect.gen(function* () {
      const config = yield* readSettlingConfig(git, directory);
      const { autoSettle, deleteSettledAfter } = branchSettings(config);
      const marked = branchSettlements(config);
      const main = (yield* readWorktrees(git, directory)).find(
        (worktree) => worktree.main,
      );
      const kept = yield* operationBranches(git, directory);
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
        (yield* listPullRequests(
          git,
          sourceControl,
          directory,
          ({ branch, default: isDefault }) =>
            !isDefault &&
            (expired.has(branch) ||
              (autoSettle && !kept.has(branch) && !marked.has(branch))),
        )).map(({ branch, pullRequests }) => [branch, pullRequests] as const),
      );
      const merged = [...pullRequests].flatMap(([branch, found]) =>
        isMerged(found) && !marked.has(branch) ? [branch] : [],
      );
      if (merged.length > 0)
        yield* writeSettlements(git, coordination, directory, merged, today);
      const locals = yield* readLocalBranches(git, directory);
      const tips = yield* mergedTips(
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
        (yield* deleteSettledBranches(
          git,
          access,
          coordination,
          directory,
          candidates,
        ));
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

function mergedTips(
  git: GitCommandRunner,
  directory: string,
  locals: ReadonlyMap<string, LocalBranchHead>,
  branches: ReadonlyMap<string, readonly HostedPullRequest[]>,
) {
  return Effect.gen(function* () {
    const merged = yield* Effect.forEach(
      [...branches],
      ([name, pullRequests]) => {
        const tip = locals.get(name)?.tip;
        const heads = mergedHeads(pullRequests);
        if (tip === undefined || heads.length === 0) return Effect.succeed([]);
        if (heads.some((head) => tip.startsWith(head)))
          return Effect.succeed([[name, tip] as const]);
        return Effect.forEach(heads, (head) =>
          runRepositoryGitOutput(
            git,
            directory,
            ["merge-base", "--is-ancestor", tip, head],
            { exitCodes: [0, 1, 128] },
          ),
        ).pipe(
          Effect.map((checks) =>
            checks.some(({ exitCode }) => exitCode === 0)
              ? [[name, tip] as const]
              : [],
          ),
        );
      },
      { concurrency: ancestryChecks },
    );
    return new Map(merged.flat());
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

function readLocalBranches(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(upstream)",
      "refs/heads",
      "refs/remotes",
    ],
    { maxOutputBytes: 16 * 1_048_576 },
  ).pipe(
    Effect.map((output) => {
      const refs = output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const [ref = "", tip = "", upstream = ""] = line.split("\0");
          return { ref, tip, upstream };
        });
      const remote = remoteBranchNames(
        refs.flatMap(({ ref }) =>
          ref.startsWith("refs/remotes/") ? [ref] : [],
        ),
      );
      return new Map(
        refs.flatMap(({ ref, tip, upstream }): [string, LocalBranchHead][] => {
          const name = ref.slice("refs/heads/".length);
          return ref.startsWith("refs/heads/")
            ? [[name, { tip, pushed: upstream !== "" || remote.has(name) }]]
            : [];
        }),
      );
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
