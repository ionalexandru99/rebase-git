import type {
  BranchUpstreamTarget,
  LocalBranch,
  RepositoryBranchesOperationFailure,
  RepositoryRejected,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures";
import {
  forEachRefFormat,
  localBranchFromRecord,
  parseForEachRef,
} from "#server/features/repository-refs/git/parse-for-each-ref";
import {
  readRefTarget,
  refCommand,
  requireValidRefName,
} from "#server/features/repository-refs/git/ref-git";
import {
  isGitRejection,
  runRepositoryGit,
} from "#server/repository/access/index";

export function branchRef(name: string) {
  return `refs/heads/${name}`;
}

export function requireValidBranchName(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  const invalid: RepositoryBranchesOperationFailure = {
    _tag: "InvalidBranchName",
    name,
  };
  if (name.startsWith("-") || name === "HEAD") return Effect.fail(invalid);
  return requireValidRefName(git, directory, branchRef(name), invalid);
}

export function readBranchTarget(
  git: GitCommandRunner,
  directory: string,
  name: string,
) {
  return readRefTarget(git, directory, `${branchRef(name)}^{commit}`);
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
        return Effect.fail<RepositoryBranchesOperationFailure>({
          _tag: "RefMissing",
          name,
        });
      if (expectedTarget !== undefined && target !== expectedTarget)
        return Effect.fail<RepositoryBranchesOperationFailure>({
          _tag: "BranchMoved",
          name,
        });
      return Effect.succeed(target);
    }),
  );
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
    refCommand,
  ).pipe(
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
    refCommand,
  ).pipe(
    Effect.mapError(
      (error): RepositoryBranchesOperationFailure | RepositoryRejected =>
        isGitRejection(error)
          ? { _tag: "RefMissing", name }
          : branchWriteFailed(error, name),
    ),
    Effect.asVoid,
  );
}
