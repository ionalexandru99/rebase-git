import { Effect } from "effect";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
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
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  readLocalBranch,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import { deleteBranches } from "#server/features/repository-refs/git/branches/delete-branches.ts";
import { renameBranch } from "#server/features/repository-refs/git/branches/rename-branch.ts";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref.ts";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import {
  createTag,
  deleteTag,
  readTagAnnotation,
} from "#server/features/repository-refs/git/repository-tags.ts";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher.ts";
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
    readonly watcher: RepositoryWatcher;
  },
) {
  return Effect.gen(function* () {
    const { access, git } = dependencies;
    const { command, query } = repositoryRoutes(dependencies);
    const changes = yield* acquireRepositoryChangePublisher(
      git,
      dependencies.watcher,
      dependencies.events,
    );
    const readRefs = (repositoryId: string) =>
      Effect.gen(function* () {
        const repository = yield* access.repository(repositoryId);
        yield* changes.watch(repository);
        return yield* readRepositoryRefs(git, repository);
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "RepositoryRejected"
            ? error
            : repositoryRejected(
                "GitFailed",
                error._tag === "GitFailed"
                  ? error.detail
                  : "The repository catalog is unavailable.",
              ),
        ),
      );
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
          (input, git) => checkoutRepositoryRef(git, access, input),
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
    } satisfies EnvironmentFeature;
  });
}

function createBranch(
  git: GitCommandRunner,
  access: RepositoryAccess,
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
      refCommand,
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
        refCommand,
      ).pipe(Effect.mapError((error) => branchWriteFailed(error, name)));
    const worktrees = yield* access.worktrees(worktreePath);
    return yield* readLocalBranch(git, worktreePath, worktrees, name);
  });
}
