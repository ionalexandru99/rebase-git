import type { BranchPulled } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  pullBlocked,
  pullFailure,
  pullGitFailed,
  type RepositoryPullError,
} from "#server/features/repository-pull/git/pull-failures";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

const pullCommand = { timeoutMilliseconds: 60_000 };

interface TrackedBranch {
  readonly name: string;
  readonly target: string;
  readonly upstreamRef: string;
  readonly upstream: string;
}

export function fastForwardBranch(
  git: GitCommandRunner,
  directory: string,
  branch: string,
  checkedOut: boolean,
): Effect.Effect<BranchPulled, RepositoryPullError> {
  return Effect.gen(function* () {
    const tracked = yield* readTrackedBranch(git, directory, branch);
    const upstreamTarget = yield* resolveUpstream(git, directory, tracked);
    const { ahead, behind } = yield* countDivergence(
      git,
      directory,
      tracked.target,
      upstreamTarget,
    );
    if (behind === 0) return { outcome: "UpToDate" } as const;
    if (ahead > 0)
      return yield* pullFailure({
        _tag: "PullDiverged",
        upstream: tracked.upstream,
        ahead,
        behind,
      });
    yield* Effect.uninterruptible(
      checkedOut
        ? mergeFastForward(git, directory, tracked, upstreamTarget)
        : moveBranch(git, directory, tracked, upstreamTarget),
    );
    return { outcome: "FastForwarded" } as const;
  }).pipe(
    Effect.catchTag("RepositoryGitError", (error) =>
      Effect.fail(pullGitFailed(error)),
    ),
  );
}

function readTrackedBranch(
  git: GitCommandRunner,
  directory: string,
  branch: string,
) {
  const ref = `refs/heads/${branch}`;
  return runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:short)",
      ref,
    ],
    pullCommand,
  ).pipe(
    Effect.flatMap((output) => {
      const [, target, upstreamRef, upstream] =
        output
          .split("\n")
          .map((line) => line.split("\0"))
          .find(([name]) => name === ref) ?? [];
      if (target === undefined)
        return Effect.fail(pullFailure({ _tag: "BranchMissing" }));
      if (!upstreamRef || !upstream)
        return Effect.fail(pullFailure({ _tag: "UpstreamMissing" }));
      return Effect.succeed<TrackedBranch>({
        name: branch,
        target,
        upstreamRef,
        upstream,
      });
    }),
  );
}

function resolveUpstream(
  git: GitCommandRunner,
  directory: string,
  tracked: TrackedBranch,
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", `${tracked.upstreamRef}^{commit}`],
    { ...pullCommand, exitCodes: [0, 1] },
  ).pipe(
    Effect.flatMap((output) =>
      output.trim() === ""
        ? Effect.fail(
            pullFailure({
              _tag: "UpstreamMissing",
              upstream: tracked.upstream,
            }),
          )
        : Effect.succeed(output.trim()),
    ),
  );
}

function countDivergence(
  git: GitCommandRunner,
  directory: string,
  target: string,
  upstreamTarget: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-list", "--left-right", "--count", `${target}...${upstreamTarget}`],
    pullCommand,
  ).pipe(
    Effect.map((output) => {
      const [ahead = 0, behind = 0] = output.trim().split(/\s+/).map(Number);
      return { ahead, behind };
    }),
  );
}

function mergeFastForward(
  git: GitCommandRunner,
  directory: string,
  tracked: TrackedBranch,
  upstreamTarget: string,
) {
  return runRepositoryGit(
    git,
    directory,
    [
      "-c",
      "merge.autoStash=false",
      "merge",
      "--ff-only",
      "--no-stat",
      upstreamTarget,
    ],
    pullCommand,
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) => mergeFailure(error, tracked)),
  );
}

function mergeFailure(error: RepositoryGitError, tracked: TrackedBranch) {
  if (!isGitRejection(error))
    return error.reason === "GitUnavailable"
      ? pullGitFailed(error)
      : pullFailure({ _tag: "PullUncertain" }, error);
  if (/would be overwritten by merge/i.test(error.detail))
    return pullFailure(
      { _tag: "PullWouldOverwrite", paths: overwrittenPaths(error.detail) },
      error,
    );
  if (/not possible to fast-forward/i.test(error.detail))
    return branchMoved(tracked);
  return pullGitFailed(error);
}

function overwrittenPaths(detail: string) {
  return detail
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.trim())
    .filter((path) => path.length > 0)
    .slice(0, 100);
}

function moveBranch(
  git: GitCommandRunner,
  directory: string,
  tracked: TrackedBranch,
  upstreamTarget: string,
) {
  return runRepositoryGit(
    git,
    directory,
    [
      "update-ref",
      "-m",
      `pull: fast-forward to ${tracked.upstream}`,
      `refs/heads/${tracked.name}`,
      upstreamTarget,
      tracked.target,
    ],
    pullCommand,
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) =>
      isGitRejection(error)
        ? branchMoved(tracked)
        : pullFailure({ _tag: "PullUncertain" }, error),
    ),
  );
}

function branchMoved(tracked: TrackedBranch) {
  return pullBlocked(`${tracked.name} changed while pulling. Try again.`);
}
