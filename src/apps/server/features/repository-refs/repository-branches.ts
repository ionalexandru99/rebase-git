import type {
  CreateRepositoryBranch,
  DeleteRepositoryBranch,
  RenameRepositoryBranch,
  SetRepositoryBranchUpstream,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import {
  branchAccessFailed,
  branchCoordinationFailed,
  type RepositoryBranchesError,
} from "#server/features/repository-refs/git/branches/branch-failures";
import { createBranch } from "#server/features/repository-refs/git/branches/create-branch";
import { deleteBranch } from "#server/features/repository-refs/git/branches/delete-branch";
import { renameBranch } from "#server/features/repository-refs/git/branches/rename-branch";
import { setBranchUpstream } from "#server/features/repository-refs/git/branches/set-branch-upstream";

export type RepositoryBranchesService = ReturnType<
  typeof createRepositoryBranchesService
>;

export function createRepositoryBranchesService(dependencies: {
  readonly access: RepositoryAccessService;
  readonly git: GitCommandRunner;
  readonly coordination: RepositoryCoordinationService;
}) {
  const { access, git, coordination } = dependencies;
  const write = <A, R>(
    scope: { readonly repositoryId: string; readonly worktreePath: string },
    operation: Effect.Effect<
      A,
      RepositoryBranchesError | EnvironmentStorageError,
      R
    >,
  ) =>
    access.requireWorktree(scope).pipe(
      Effect.mapError(branchAccessFailed),
      Effect.andThen(coordination.run(scope.worktreePath, "branch", operation)),
      Effect.catchTag("RepositoryCoordinationError", (error) =>
        Effect.fail(branchCoordinationFailed(error)),
      ),
    );
  return {
    create: (command: CreateRepositoryBranch) =>
      write(command, createBranch(git, access, command)),
    delete: (command: DeleteRepositoryBranch) =>
      write(command, deleteBranch(git, access, command)),
    rename: (command: RenameRepositoryBranch) =>
      write(command, renameBranch(git, access, command)),
    setUpstream: (command: SetRepositoryBranchUpstream) =>
      write(command, setBranchUpstream(git, access, command)),
  };
}
