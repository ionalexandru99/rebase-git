import type {
  CreateRepositoryBranch,
  RepositoryBranchesOperationFailure,
  RepositoryRejected,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures";
import {
  branchCommand,
  readLocalBranch,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git";
import { runRepositoryGit } from "#server/repository/access/index";

export function createBranch(
  git: GitCommandRunner,
  access: RepositoryAccessService,
  command: CreateRepositoryBranch,
) {
  const { name, startPoint, track, worktreePath } = command;
  return Effect.gen(function* () {
    yield* requireValidBranchName(git, worktreePath, name);
    if (track !== undefined)
      yield* requireRemoteBranch(git, worktreePath, track);
    yield* runRepositoryGit(
      git,
      worktreePath,
      ["branch", "--no-track", name, startPoint],
      branchCommand,
    ).pipe(
      Effect.mapError(
        (error): RepositoryBranchesOperationFailure | RepositoryRejected =>
          /not a valid object name/i.test(error.detail)
            ? { _tag: "RefMissing", name: startPoint }
            : branchWriteFailed(error, name),
      ),
    );
    if (track !== undefined)
      yield* runRepositoryGit(
        git,
        worktreePath,
        setUpstreamArguments(name, track),
        branchCommand,
      ).pipe(Effect.mapError((error) => branchWriteFailed(error, name)));
    const worktrees = yield* access.worktrees(worktreePath);
    return yield* readLocalBranch(git, worktreePath, worktrees, name);
  });
}
