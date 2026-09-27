import type {
  RenameRepositoryBranch,
  RepositoryBranchesOperationFailure,
  RepositoryBranchRenamed,
  RepositoryRejected,
  RepositoryWorktree,
} from "@rebase/contracts";
import { Effect } from "effect";
import {
  type GitCommandRunner,
  type GitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures";
import {
  readBranchTarget,
  readLocalBranch,
  requireValidBranchName,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git";
import { refCommand } from "#server/features/repository-refs/git/ref-git";
import type { RepositoryAccess } from "#server/repository/repository-access";

export function renameBranch(
  git: GitCommandRunner,
  access: RepositoryAccess,
  command: RenameRepositoryBranch,
): Effect.Effect<
  RepositoryBranchRenamed,
  RepositoryBranchesOperationFailure | RepositoryRejected | GitFailed
> {
  const { name, newName, worktreePath } = command;
  return Effect.gen(function* () {
    yield* requireValidBranchName(git, worktreePath, newName);
    const before = yield* access.worktrees(worktreePath);
    yield* rejectHeldElsewhere(before, name, worktreePath);
    yield* requireRenameSource(git, command, before);
    yield* runRepositoryGit(
      git,
      worktreePath,
      ["branch", "-m", name, newName],
      refCommand,
    ).pipe(Effect.mapError((error) => branchWriteFailed(error, newName)));
    const after = yield* access.worktrees(worktreePath);
    const branch = yield* readLocalBranch(git, worktreePath, after, newName);
    return { branch, previousName: name };
  });
}

function requireRenameSource(
  git: GitCommandRunner,
  { expectedTarget, name, worktreePath }: RenameRepositoryBranch,
  worktrees: readonly RepositoryWorktree[],
) {
  return readBranchTarget(git, worktreePath, name).pipe(
    Effect.flatMap((target) => {
      if (target !== undefined)
        return target === expectedTarget
          ? Effect.void
          : Effect.fail<RepositoryBranchesOperationFailure>({
              _tag: "BranchMoved",
              name,
            });
      const unbornHere =
        expectedTarget === undefined &&
        worktreeHolding(worktrees, name)?.path === worktreePath;
      return unbornHere
        ? Effect.void
        : Effect.fail<RepositoryBranchesOperationFailure>({
            _tag: "RefMissing",
            name,
          });
    }),
  );
}

function rejectHeldElsewhere(
  worktrees: readonly RepositoryWorktree[],
  name: string,
  worktreePath: string,
) {
  const holder = worktreeHolding(worktrees, name);
  return holder === undefined || holder.path === worktreePath
    ? Effect.void
    : Effect.fail<RepositoryBranchesOperationFailure>({
        _tag: "BranchCheckedOutElsewhere",
        name,
        worktreePath: holder.path,
      });
}
