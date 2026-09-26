import type { SetRepositoryBranchUpstream } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures";
import {
  readLocalBranch,
  requireBranchTarget,
  requireRemoteBranch,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git";
import { refCommand } from "#server/features/repository-refs/git/ref-git";
import { runRepositoryGit } from "#server/repository/access/index";

export function setBranchUpstream(
  git: GitCommandRunner,
  access: RepositoryAccessService,
  command: SetRepositoryBranchUpstream,
) {
  const { name, upstream, worktreePath } = command;
  return Effect.gen(function* () {
    yield* requireBranchTarget(git, worktreePath, name, undefined);
    if (upstream === null) yield* unsetUpstream(git, worktreePath, name);
    else {
      yield* requireRemoteBranch(git, worktreePath, upstream);
      yield* runRepositoryGit(
        git,
        worktreePath,
        setUpstreamArguments(name, upstream),
        refCommand,
      ).pipe(Effect.mapError((error) => branchWriteFailed(error, name)));
    }
    const worktrees = yield* access.worktrees(worktreePath);
    return yield* readLocalBranch(git, worktreePath, worktrees, name);
  });
}

function unsetUpstream(git: GitCommandRunner, directory: string, name: string) {
  return runRepositoryGit(
    git,
    directory,
    ["branch", "--unset-upstream", name],
    refCommand,
  ).pipe(
    Effect.asVoid,
    Effect.catchIf(
      (error) => /has no upstream information/i.test(error.detail),
      () => Effect.void,
    ),
    Effect.mapError((error) => branchWriteFailed(error, name)),
  );
}
