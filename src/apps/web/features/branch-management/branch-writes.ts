import type { RepositoryRefs } from "@rebase/contracts";
import { Effect } from "effect";
import {
  withBranch,
  withoutDeletedBranches,
  withRenamedBranch,
} from "#web/features/branch-management/apply-branch-changes";
import type {
  BranchManagementError,
  BranchWrites,
  RepositoryBranchesClient,
} from "#web/features/branch-management/branch-management.contract";
import type { RepositoryRefsController } from "#web/features/repository-refs/index";

export function createBranchWrites(
  client: RepositoryBranchesClient,
  refs: Pick<RepositoryRefsController, "apply">,
): BranchWrites {
  const write = async <Result>(
    repositoryId: string,
    request: Effect.Effect<Result, BranchManagementError>,
    change: (current: RepositoryRefs, result: Result) => RepositoryRefs,
  ) => {
    const result = await Effect.runPromise(request);
    refs.apply(repositoryId, (current) => change(current, result));
    return result;
  };
  return {
    create: (command) =>
      write(command.repositoryId, client.create(command), withBranch),
    delete: (command) =>
      write(
        command.repositoryId,
        client.delete(command),
        withoutDeletedBranches,
      ),
    rename: (command) =>
      write(command.repositoryId, client.rename(command), (current, result) =>
        withRenamedBranch(current, result.previousName, result.branch),
      ),
    setUpstream: (command) =>
      write(command.repositoryId, client.setUpstream(command), withBranch),
  };
}
