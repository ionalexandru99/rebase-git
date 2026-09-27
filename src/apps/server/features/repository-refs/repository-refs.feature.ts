import {
  type CreateRepositoryBranch,
  RepositoryBranchesHttpApi,
  type RepositoryBranchesOperationFailure,
  RepositoryRefsHttpApi,
  type RepositoryRejected,
  RepositoryTagsHttpApi,
  repositoryRejected,
  type SetRepositoryBranchUpstream,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures";
import {
  readLocalBranch,
  requireBranchTarget,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git";
import { deleteBranch } from "#server/features/repository-refs/git/branches/delete-branch";
import { renameBranch } from "#server/features/repository-refs/git/branches/rename-branch";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs";
import { refCommand } from "#server/features/repository-refs/git/ref-git";
import {
  createTag,
  deleteTag,
} from "#server/features/repository-refs/git/repository-tags";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { repositoryRefsRpc } from "#server/features/repository-refs/repository-refs-rpc";
import type { RepositoryAccess } from "#server/repository/repository-access";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination";

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
    const { command } = repositoryRoutes(dependencies);
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
    const branches = RepositoryBranchesHttpApi;
    return {
      capabilities: ["repository-refs"],
      httpRoutes: [
        command(
          RepositoryRefsHttpApi.checkout,
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
        command(branches.setUpstream, branchPolicy, (input, git) =>
          setBranchUpstream(git, access, input),
        ),
        command(branches.delete, branchPolicy, (input, git) =>
          deleteBranch(git, access, input),
        ),
        command(RepositoryTagsHttpApi.create, tagPolicy, (input, git) =>
          createTag(git, input),
        ),
        command(RepositoryTagsHttpApi.delete, tagPolicy, (input, git) =>
          deleteTag(git, input),
        ),
      ],
      rpc: (session) => repositoryRefsRpc(session, readRefs),
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

function setBranchUpstream(
  git: GitCommandRunner,
  access: RepositoryAccess,
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
