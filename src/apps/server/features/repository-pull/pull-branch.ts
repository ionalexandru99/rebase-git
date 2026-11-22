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
import { uninterruptible } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  isGitRejection,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import {
  fetchLargeFiles,
  type GitLfs,
} from "#server/features/repository-lfs/git-lfs.ts";
import {
  isGitLocked,
  overwrittenPaths,
  readCommit,
} from "#server/features/repository-operations/operation-outcome.ts";
import {
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

export async function pullBranch(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  lfs: GitLfs,
  { directory, branch, checkedOut, strategy }: PullTarget,
  stored: () => Promise<PullStrategy>,
): Promise<BranchPulled> {
  const tracked = await readTrackedBranch(git, directory, branch);
  const upstreamTarget = await resolveUpstream(git, directory, tracked);
  if (strategy !== undefined && strategy.upstream !== upstreamTarget)
    throw { _tag: "UpstreamMoved" } satisfies PullFailure;
  const { ahead, behind } = await countDivergence(
    git,
    directory,
    tracked.target,
    upstreamTarget,
  );
  if (behind === 0) return { outcome: "UpToDate", stashKept: false };
  if (checkedOut) await fetchLargeFiles(lfs, git, directory, upstreamTarget);
  if (ahead === 0) {
    return {
      outcome: "FastForwarded",
      ...(await uninterruptible(() =>
        checkedOut
          ? mergeFastForward(git, directory, upstreamTarget)
          : moveBranch(git, directory, tracked, upstreamTarget).then(
              () => unstashed,
            ),
      )),
    };
  }
  if (!checkedOut) throw pullBlocked("The branch has diverged.");
  const kind = strategy?.kind ?? (await stored());
  if (kind === "ask")
    throw {
      _tag: "PullDiverged",
      upstream: tracked.upstream,
      upstreamCommit: upstreamTarget,
    } satisfies PullFailure;
  return integrate(git, coordination, directory, kind, tracked, upstreamTarget);
}

async function integrate(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  directory: string,
  kind: DivergedPull,
  tracked: TrackedBranch,
  upstreamTarget: string,
): Promise<BranchPulled> {
  const expected = { worktreePath: directory, expectedHead: tracked.target };
  const upstream = { ref: tracked.upstreamRef, commit: upstreamTarget };
  try {
    const { started, autostashConflict } =
      kind === "merge"
        ? await mergeSource(
            git,
            coordination,
            expected,
            { _tag: "Merge", source: upstream, mode: "merge" },
            true,
          )
        : await rebaseOnto(
            git,
            coordination,
            expected,
            { _tag: "Rebase", onto: upstream, stash: true },
            false,
          );
    if (started.outcome === "Stopped")
      return {
        outcome: "Stopped",
        worktreePath: directory,
        operation: started.operation,
      };
    return {
      outcome: kind === "merge" ? "Merged" : "Rebased",
      ...(await pulledStash(git, directory, autostashConflict ?? "")),
    };
  } catch (error) {
    if (!isIntegrationFailure(error)) throw error;
    return failWithKeptStash(
      git,
      directory,
      error.detail ?? "",
      error._tag === "OperationFailed" ? integrationFailure(error) : error,
    );
  }
}

function isIntegrationFailure(
  error: unknown,
): error is OperationFailure | RepositoryRejected | GitFailed {
  return (
    isGitFailed(error) ||
    (typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      (error._tag === "OperationFailed" || error._tag === "RepositoryRejected"))
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

async function readTrackedBranch(
  git: GitCommandRunner,
  directory: string,
  branch: string,
): Promise<TrackedBranch> {
  const ref = `refs/heads/${branch}`;
  const output = await runRepositoryGit(
    git,
    directory,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:short)",
      ref,
    ],
    pullCommand,
  );
  const [, target, upstreamRef, upstream] =
    output
      .split("\n")
      .map((line) => line.split("\0"))
      .find(([name]) => name === ref) ?? [];
  if (target === undefined)
    throw { _tag: "BranchMissing" } satisfies PullFailure;
  if (!upstreamRef || !upstream)
    throw { _tag: "UpstreamMissing" } satisfies PullFailure;
  return { name: branch, target, upstreamRef, upstream };
}

async function resolveUpstream(
  git: GitCommandRunner,
  directory: string,
  tracked: TrackedBranch,
) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", `${tracked.upstreamRef}^{commit}`],
    { ...pullCommand, exitCodes: [0, 1] },
  );
  if (output.trim() === "")
    throw {
      _tag: "UpstreamMissing",
      upstream: tracked.upstream,
    } satisfies PullFailure;
  return output.trim();
}

async function countDivergence(
  git: GitCommandRunner,
  directory: string,
  target: string,
  upstreamTarget: string,
) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["rev-list", "--left-right", "--count", `${target}...${upstreamTarget}`],
    pullCommand,
  );
  const [ahead = 0, behind = 0] = output.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

async function mergeFastForward(
  git: GitCommandRunner,
  directory: string,
  upstreamTarget: string,
): Promise<PulledStash> {
  let stderr: string;
  try {
    ({ stderr } = await runRepositoryGitOutput(
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
    ));
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    if (isGitRejection(error))
      return failWithKeptStash(
        git,
        directory,
        error.detail,
        mergeFailure(error),
      );
    await requireAt(git, directory, "HEAD", upstreamTarget, error);
    return unstashed;
  }
  return pulledStash(git, directory, stderr);
}

type PulledStash = Pick<
  Extract<BranchPulled, { readonly stashKept: boolean }>,
  "stashKept" | "movedToStash"
>;

const unstashed: PulledStash = { stashKept: false };

async function pulledStash(
  git: GitCommandRunner,
  directory: string,
  text: string,
): Promise<PulledStash> {
  const stash = await keptAutostash(git, directory, text);
  if (stash === undefined)
    return { stashKept: /resulted in conflicts/.test(text) };
  const { exitCode } = await runRepositoryGitOutput(
    git,
    directory,
    ["diff", "--quiet", "HEAD"],
    { ...pullCommand, exitCodes: [0, 1] },
  );
  return exitCode === 0
    ? { stashKept: false, movedToStash: stash }
    : { stashKept: true };
}

async function failWithKeptStash(
  git: GitCommandRunner,
  directory: string,
  detail: string,
  failure: unknown,
): Promise<never> {
  const stash = await keptAutostash(git, directory, detail);
  if (stash === undefined) throw failure;
  throw {
    _tag: "PullStashKept",
    stash,
    busy: isGitLocked(detail),
  } satisfies PullFailure;
}

async function keptAutostash(
  git: GitCommandRunner,
  directory: string,
  text: string,
) {
  if (!/safe in the stash/.test(text)) return undefined;
  const output = await runRepositoryGit(
    git,
    directory,
    ["log", "--walk-reflogs", "-1", "--format=%H%x00%gs", "refs/stash"],
    { ...pullCommand, exitCodes: [0, 128] },
  );
  const [stash, subject] = output.trim().split("\0");
  return stash && subject === "autostash" ? stash : undefined;
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

async function moveBranch(
  git: GitCommandRunner,
  directory: string,
  tracked: TrackedBranch,
  upstreamTarget: string,
) {
  try {
    await runRepositoryGit(
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
    );
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    if (isGitRejection(error)) throw branchMoved();
    await requireAt(
      git,
      directory,
      `refs/heads/${tracked.name}`,
      upstreamTarget,
      error,
    );
  }
}

async function requireAt(
  git: GitCommandRunner,
  directory: string,
  ref: string,
  target: string,
  failure: GitFailed,
) {
  if ((await readCommit(git, directory, ref)) !== target) throw failure;
}

function branchMoved() {
  return pullBlocked("The branch changed while pulling.");
}

export function pullBlocked(detail: string): PullFailure {
  return { _tag: "PullBlocked", detail: detail.slice(0, 2_048) };
}
