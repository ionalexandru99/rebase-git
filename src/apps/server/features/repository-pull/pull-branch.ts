import { Effect } from "effect";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type { OperationFailure } from "#contracts/repository-operations/repository-operations.contract.ts";
import type {
  BranchPulled,
  DivergedPull,
  PullBranch,
  PullFailure,
  PullStrategy,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitRejection,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { overwrittenPaths } from "#server/features/repository-operations/operation-outcome.ts";
import {
  type Integrated,
  mergeSource,
  rebaseOnto,
} from "#server/features/repository-operations/start-operation.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

const pullCommand = { timeoutMilliseconds: 60_000 };

interface TrackedBranch {
  readonly name: string;
  readonly target: string;
  readonly upstreamRef: string;
  readonly upstream: string;
}

export interface PullTarget {
  readonly directory: string;
  readonly branch: string;
  readonly checkedOut: boolean;
  readonly strategy: PullBranch["strategy"];
}

export function pullBranch<E>(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { directory, branch, checkedOut, strategy }: PullTarget,
  stored: Effect.Effect<PullStrategy, E>,
): Effect.Effect<
  BranchPulled,
  PullFailure | RepositoryRejected | GitFailed | E
> {
  return Effect.gen(function* () {
    const tracked = yield* readTrackedBranch(git, directory, branch);
    const upstreamTarget = yield* resolveUpstream(git, directory, tracked);
    if (strategy !== undefined && strategy.upstream !== upstreamTarget)
      return yield* Effect.fail<PullFailure>({ _tag: "UpstreamMoved" });
    const { ahead, behind } = yield* countDivergence(
      git,
      directory,
      tracked.target,
      upstreamTarget,
    );
    if (behind === 0) return { outcome: "UpToDate", stashKept: false } as const;
    if (ahead === 0)
      return {
        outcome: "FastForwarded",
        stashKept: yield* Effect.uninterruptible(
          checkedOut
            ? mergeFastForward(git, directory, upstreamTarget)
            : moveBranch(git, directory, tracked, upstreamTarget).pipe(
                Effect.as(false),
              ),
        ),
      } as const;
    if (!checkedOut)
      return yield* Effect.fail(pullBlocked("The branch has diverged."));
    const kind = strategy?.kind ?? (yield* stored);
    if (kind === "ask")
      return yield* Effect.fail<PullFailure>({
        _tag: "PullDiverged",
        upstream: tracked.upstream,
        upstreamCommit: upstreamTarget,
      });
    return yield* integrate(
      git,
      coordination,
      directory,
      kind,
      tracked,
      upstreamTarget,
    );
  });
}

function integrate(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  directory: string,
  kind: DivergedPull,
  tracked: TrackedBranch,
  upstreamTarget: string,
) {
  const expected = { worktreePath: directory, expectedHead: tracked.target };
  const upstream = { ref: tracked.upstreamRef, commit: upstreamTarget };
  const integration: Effect.Effect<
    Integrated,
    OperationFailure | RepositoryRejected | GitFailed
  > =
    kind === "merge"
      ? mergeSource(
          git,
          coordination,
          expected,
          { _tag: "Merge", source: upstream, mode: "merge" },
          true,
        )
      : rebaseOnto(
          git,
          coordination,
          expected,
          { _tag: "Rebase", onto: upstream, stash: true },
          false,
        );
  return integration.pipe(
    Effect.map(({ started, autostashConflict }): BranchPulled => {
      if (started.outcome === "Stopped")
        return {
          outcome: "Stopped",
          worktreePath: directory,
          operation: started.operation,
        };
      return {
        outcome: kind === "merge" ? "Merged" : "Rebased",
        stashKept: autostashConflict !== undefined,
      };
    }),
    Effect.mapError((error) =>
      error._tag === "OperationFailed" ? integrationFailure(error) : error,
    ),
  );
}

function integrationFailure(failure: OperationFailure): PullFailure {
  switch (failure.reason) {
    case "Uncertain":
      return { _tag: "PullUncertain" };
    case "WouldOverwrite":
      return { _tag: "PullWouldOverwrite", paths: failure.paths ?? [] };
    case "Stale":
      return branchMoved();
    case "Unrelated":
      return pullBlocked("The remote branch has no history in common.");
    default:
      return pullBlocked(failure.detail);
  }
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
        return Effect.fail<PullFailure>({ _tag: "BranchMissing" });
      if (!upstreamRef || !upstream)
        return Effect.fail<PullFailure>({ _tag: "UpstreamMissing" });
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
        ? Effect.fail<PullFailure>({
            _tag: "UpstreamMissing",
            upstream: tracked.upstream,
          })
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
  upstreamTarget: string,
) {
  return runRepositoryGitOutput(
    git,
    directory,
    [
      "merge",
      "--ff-only",
      "--autostash",
      "--no-stat",
      "--progress",
      upstreamTarget,
    ],
    pullCommand,
  ).pipe(
    Effect.map(({ stderr }) => /resulted in conflicts/.test(stderr)),
    Effect.mapError((error) => mergeFailure(error)),
  );
}

function mergeFailure(error: GitFailed): PullFailure | RepositoryRejected {
  if (!isGitRejection(error))
    return error.reason === "GitUnavailable"
      ? repositoryRejected("GitFailed", error.detail)
      : { _tag: "PullUncertain" };
  if (/would be overwritten by merge/i.test(error.detail))
    return {
      _tag: "PullWouldOverwrite",
      paths: overwrittenPaths(error.detail),
    };
  if (/not possible to fast-forward/i.test(error.detail)) return branchMoved();
  return repositoryRejected("GitFailed", error.detail);
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
    Effect.mapError(
      (error): PullFailure =>
        isGitRejection(error) ? branchMoved() : { _tag: "PullUncertain" },
    ),
  );
}

function branchMoved() {
  return pullBlocked("The branch changed while pulling.");
}

export function pullBlocked(detail: string): PullFailure {
  return { _tag: "PullBlocked", detail: detail.slice(0, 2_048) };
}
