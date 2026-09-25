import type {
  BranchUpstreamTarget,
  LocalBranch,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import {
  branchAccessFailed,
  branchesFailure,
  branchGitFailed,
  branchWriteFailed,
} from "#server/features/repository-refs/git/branches/branch-failures";
import {
  forEachRefFormat,
  localBranchFromRecord,
  parseForEachRef,
} from "#server/features/repository-refs/git/parse-for-each-ref";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

export const branchCommand = {
  literalPathspecs: false,
  timeoutMilliseconds: 30_000,
};

export function branchRef(name: string) {
  return `refs/heads/${name}`;
}

export function requireValidBranchName(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  const invalid = branchesFailure({ _tag: "InvalidBranchName", name });
  if (name.startsWith("-") || name === "HEAD") return Effect.fail(invalid);
  return runRepositoryGit(
    git,
    directory,
    ["check-ref-format", branchRef(name)],
    branchCommand,
  ).pipe(
    Effect.catchIf(isGitRejection, () => Effect.fail(invalid)),
    Effect.mapError((error) =>
      error._tag === "RepositoryGitError" ? branchGitFailed(error) : error,
    ),
    Effect.asVoid,
  );
}

export function readBranchTarget(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", `${branchRef(name)}^{commit}`],
    { ...branchCommand, exitCodes: [0, 1] },
  ).pipe(
    Effect.map((output) => output.trim() || undefined),
    Effect.mapError(branchGitFailed),
  );
}

export function requireBranchTarget(
  git: GitCommandRunner,
  directory: string,
  name: string,
  expectedTarget: string | undefined,
) {
  return readBranchTarget(git, directory, name).pipe(
    Effect.flatMap((target) => {
      if (target === undefined)
        return Effect.fail(branchesFailure({ _tag: "RefMissing", name }));
      if (expectedTarget !== undefined && target !== expectedTarget)
        return Effect.fail(branchesFailure({ _tag: "BranchMoved", name }));
      return Effect.succeed(target);
    }),
  );
}

export function readBranchWorktrees(
  access: RepositoryAccessService,
  worktreePath: string,
) {
  return access
    .worktrees(worktreePath)
    .pipe(Effect.mapError(branchAccessFailed));
}

export function worktreeHolding(
  worktrees: readonly RepositoryWorktree[],
  name: string,
) {
  return worktrees.find((worktree) => worktree.head.branch === name);
}

export function readLocalBranch(
  git: GitCommandRunner,
  directory: string,
  worktrees: readonly RepositoryWorktree[],
  name: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["for-each-ref", `--format=${forEachRefFormat}`, branchRef(name)],
    branchCommand,
  ).pipe(
    Effect.mapError(branchGitFailed),
    Effect.map((output): LocalBranch => {
      const record = parseForEachRef(output).find(
        (candidate) => candidate.name === branchRef(name),
      );
      const { worktreePath: _raw, ...branch } = (record === undefined
        ? undefined
        : localBranchFromRecord(record)) ?? { name };
      const holder = worktreeHolding(worktrees, name);
      return holder === undefined
        ? branch
        : { ...branch, worktreePath: holder.path };
    }),
  );
}

export function setUpstreamArguments(
  name: string,
  upstream: BranchUpstreamTarget,
) {
  return [
    "branch",
    `--set-upstream-to=refs/remotes/${upstream.remote}/${upstream.name}`,
    name,
  ];
}

export function requireRemoteBranch(
  git: GitCommandRunner,
  directory: string,
  upstream: BranchUpstreamTarget,
) {
  const name = `${upstream.remote}/${upstream.name}`;
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`],
    branchCommand,
  ).pipe(
    Effect.catchIf(isGitRejection, (error) =>
      Effect.fail(branchesFailure({ _tag: "RefMissing", name }, error)),
    ),
    Effect.mapError((error) =>
      error._tag === "RepositoryGitError"
        ? branchWriteFailed(error, name)
        : error,
    ),
    Effect.asVoid,
  );
}
