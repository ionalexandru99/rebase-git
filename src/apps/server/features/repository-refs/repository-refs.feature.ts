import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type CreateRepositoryBranch,
  RepositoryBranchesApi,
  type RepositoryBranchesOperationFailure,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  readLocalBranch,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import {
  deleteBranches,
  readUnmergedBranches,
} from "#server/features/repository-refs/git/branches/delete-branches.ts";
import { renameBranch } from "#server/features/repository-refs/git/branches/rename-branch.ts";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref.ts";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import {
  createTag,
  deleteTag,
  readTagAnnotation,
} from "#server/features/repository-refs/git/repository-tags.ts";
import type { RepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination.ts";

const branchPolicy: RepositoryWritePolicy = {
  name: "branch",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

const tagPolicy: RepositoryWritePolicy = {
  name: "tag",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

export function repositoryRefsFeature(
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
    readonly changes: RepositoryChangePublisher;
  },
): EnvironmentFeature {
  const { access, git, changes } = dependencies;
  const { command, query } = repositoryRoutes(dependencies);
  const readRefs = async (repositoryId: string) => {
    const repository = await access.repository(repositoryId);
    await changes.watch(repository);
    try {
      return await readRepositoryRefs(git, repository);
    } catch (error) {
      throw isGitFailed(error)
        ? repositoryRejected("GitFailed", error.detail)
        : error;
    }
  };
  const branches = RepositoryBranchesApi;
  return {
    routes: [
      route(RepositoryRefsApi.read, (input) => readRefs(input.repositoryId)),
      command(
        RepositoryRefsApi.checkout,
        {
          name: "checkout",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "block",
        },
        (input, git) =>
          checkoutRepositoryRef(git, access, dependencies.lfs, input),
      ),
      command(branches.create, branchPolicy, (input, git) =>
        createBranch(git, access, input),
      ),
      command(branches.rename, branchPolicy, (input, git) =>
        renameBranch(git, access, input),
      ),
      command(branches.delete, branchPolicy, (input, git) =>
        deleteBranches(git, access, input),
      ),
      query(branches.unmerged, (input, git) =>
        readUnmergedBranches(git, input),
      ),
      command(RepositoryTagsApi.create, tagPolicy, (input, git) =>
        createTag(git, input),
      ),
      command(RepositoryTagsApi.delete, tagPolicy, (input, git) =>
        deleteTag(git, input),
      ),
      query(RepositoryTagsApi.annotation, (input, git) =>
        readTagAnnotation(git, input),
      ),
    ],
  };
}

async function createBranch(
  git: GitCommandRunner,
  access: RepositoryAccess,
  command: CreateRepositoryBranch,
) {
  const { name, startPoint, track, worktreePath } = command;
  await requireValidBranchName(git, worktreePath, name);
  if (track !== undefined) await requireRemoteBranch(git, worktreePath, track);
  try {
    await runRepositoryGit(
      git,
      worktreePath,
      ["branch", "--no-track", name, startPoint],
      refCommand,
    );
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw /not a valid object name/i.test(error.detail)
      ? ({
          _tag: "RefMissing",
          name: startPoint,
        } satisfies RepositoryBranchesOperationFailure)
      : branchWriteFailed(error, name);
  }
  if (track !== undefined)
    try {
      await runRepositoryGit(
        git,
        worktreePath,
        setUpstreamArguments(name, track),
        refCommand,
      );
    } catch (error) {
      throw isGitFailed(error) ? branchWriteFailed(error, name) : error;
    }
  const worktrees = await access.worktrees(worktreePath);
  return readLocalBranch(git, worktreePath, worktrees, name);
}
