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
import {
  isGitLocked,
  overwrittenPaths,
  readCommit,
} from "#server/features/repository-operations/operation-outcome.ts";
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
        ...(yield* Effect.uninterruptible(
          checkedOut
            ? mergeFastForward(git, directory, upstreamTarget)
            : moveBranch(git, directory, tracked, upstreamTarget).pipe(
                Effect.as(unstashed),
              ),
        )),
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
    Effect.flatMap(
      ({
        started,
        autostashConflict,
      }): Effect.Effect<BranchPulled, GitFailed> =>
        started.outcome === "Stopped"
          ? Effect.succeed({
              outcome: "Stopped",
              worktreePath: directory,
              operation: started.operation,
            })
          : pulledStash(git, directory, autostashConflict ?? "").pipe(
              Effect.map((stash) => ({
                outcome: kind === "merge" ? "Merged" : "Rebased",
                ...stash,
              })),
            ),
    ),
    Effect.catch((error) =>
      failWithKeptStash(
        git,
        directory,
        error.detail ?? "",
        error._tag === "OperationFailed" ? integrationFailure(error) : error,
      ),
    ),
  );
}

function integrationFailure(failure: OperationFailure): PullFailure {
  switch (failure.reason) {
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
    Effect.flatMap(({ stderr }) => pulledStash(git, directory, stderr)),
    Effect.catch(
      (
        error,
      ): Effect.Effect<
        PulledStash,
        PullFailure | RepositoryRejected | GitFailed
      > =>
        isGitRejection(error)
          ? failWithKeptStash(git, directory, error.detail, mergeFailure(error))
          : requireAt(git, directory, "HEAD", upstreamTarget, error).pipe(
              Effect.as(unstashed),
            ),
    ),
  );
}

type PulledStash = Pick<
  Extract<BranchPulled, { readonly stashKept: boolean }>,
  "stashKept" | "movedToStash"
>;

const unstashed: PulledStash = { stashKept: false };

function pulledStash(git: GitCommandRunner, directory: string, text: string) {
  return keptAutostash(git, directory, text).pipe(
    Effect.flatMap(
      (stash): Effect.Effect<PulledStash, GitFailed> =>
        stash === undefined
          ? Effect.succeed({ stashKept: /resulted in conflicts/.test(text) })
          : runRepositoryGitOutput(
              git,
              directory,
              ["diff", "--quiet", "HEAD"],
              { ...pullCommand, exitCodes: [0, 1] },
            ).pipe(
              Effect.map(({ exitCode }) =>
                exitCode === 0
                  ? { stashKept: false, movedToStash: stash }
                  : { stashKept: true },
              ),
            ),
    ),
  );
}

function failWithKeptStash<Failure>(
  git: GitCommandRunner,
  directory: string,
  detail: string,
  failure: Failure,
) {
  return keptAutostash(git, directory, detail).pipe(
    Effect.flatMap((stash) =>
      stash === undefined
        ? Effect.fail(failure)
        : Effect.fail<PullFailure | Failure>({
            _tag: "PullStashKept",
            stash,
            busy: isGitLocked(detail),
          }),
    ),
  );
}

function keptAutostash(git: GitCommandRunner, directory: string, text: string) {
  if (!/safe in the stash/.test(text)) return Effect.succeed(undefined);
  return runRepositoryGit(
    git,
    directory,
    ["log", "--walk-reflogs", "-1", "--format=%H%x00%gs", "refs/stash"],
    { ...pullCommand, exitCodes: [0, 128] },
  ).pipe(
    Effect.map((output) => {
      const [stash, subject] = output.trim().split("\0");
      return stash && subject === "autostash" ? stash : undefined;
    }),
  );
}

function mergeFailure(error: GitFailed): PullFailure | RepositoryRejected {
  if (isGitLocked(error.detail))
    return repositoryRejected("Busy", error.detail);
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
    Effect.catch(
      (error): Effect.Effect<void, PullFailure | GitFailed> =>
        isGitRejection(error)
          ? Effect.fail(branchMoved())
          : requireAt(
              git,
              directory,
              `refs/heads/${tracked.name}`,
              upstreamTarget,
              error,
            ),
    ),
  );
}

function requireAt(
  git: GitCommandRunner,
  directory: string,
  ref: string,
  target: string,
  failure: GitFailed,
) {
  return readCommit(git, directory, ref).pipe(
    Effect.flatMap((tip) =>
      tip === target ? Effect.void : Effect.fail(failure),
    ),
  );
}

function branchMoved() {
  return pullBlocked("The branch changed while pulling.");
}

export function pullBlocked(detail: string): PullFailure {
  return { _tag: "PullBlocked", detail: detail.slice(0, 2_048) };
}
