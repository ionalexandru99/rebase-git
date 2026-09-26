import {
  RepositoryBranchesHttpApi,
  RepositoryRefsHttpApi,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { command } from "#server/adapters/environment-transport/http/repository-http-routes";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import { createBranch } from "#server/features/repository-refs/git/branches/create-branch";
import { deleteBranch } from "#server/features/repository-refs/git/branches/delete-branch";
import { renameBranch } from "#server/features/repository-refs/git/branches/rename-branch";
import { setBranchUpstream } from "#server/features/repository-refs/git/branches/set-branch-upstream";
import { checkoutRepositoryRef } from "#server/features/repository-refs/git/checkout-repository-ref";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsReader } from "#server/features/repository-refs/repository-refs";
import { repositoryRefsRpc } from "#server/features/repository-refs/rpc/repository-refs-rpc";

const branchPolicy: RepositoryWritePolicy = {
  name: "branch",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

export const repositoryRefsFeature = Effect.gen(function* () {
  const git = yield* GitCommands;
  const access = yield* RepositoryAccess;
  const refs = createRepositoryRefsReader({
    access,
    changes: yield* acquireRepositoryChangePublisher(
      git,
      yield* RepositoryWatching,
      yield* EnvironmentEvents,
    ),
    git,
  });
  const branches = RepositoryBranchesHttpApi;
  return {
    capabilities: ["repository-refs"],
    httpRoutes: [
      yield* command(
        RepositoryRefsHttpApi.checkout,
        {
          name: "checkout",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "block",
        },
        (input, git) => checkoutRepositoryRef(git, access, input),
      ),
      yield* command(branches.create, branchPolicy, (input, git) =>
        createBranch(git, access, input),
      ),
      yield* command(branches.rename, branchPolicy, (input, git) =>
        renameBranch(git, access, input),
      ),
      yield* command(branches.setUpstream, branchPolicy, (input, git) =>
        setBranchUpstream(git, access, input),
      ),
      yield* command(branches.delete, branchPolicy, (input, git) =>
        deleteBranch(git, access, input),
      ),
    ],
    rpc: (session) => repositoryRefsRpc(session, refs),
  } satisfies EnvironmentFeature;
});
