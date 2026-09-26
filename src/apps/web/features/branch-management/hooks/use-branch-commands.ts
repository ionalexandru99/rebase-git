import {
  type OperationScope,
  RepositoryBranchesHttpApi,
  type RouteInput,
} from "@rebase/contracts";
import {
  withBranch,
  withoutDeletedBranches,
  withRenamedBranch,
} from "#web/features/branch-management/apply-branch-changes";
import { useApplyToRefs } from "#web/features/repository-refs/hooks/use-apply-to-refs";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import {
  type CommandFailure,
  settleCommand,
  useCommand,
} from "#web/platform/query/use-command";

type BranchRoute =
  (typeof RepositoryBranchesHttpApi)[keyof typeof RepositoryBranchesHttpApi];

export type BranchCommandFailure = CommandFailure<BranchRoute>;

type BranchRequest<Route extends BranchRoute> = Omit<
  RouteInput<Route>,
  keyof OperationScope
>;

export type BranchCommands = NonNullable<ReturnType<typeof useBranchCommands>>;

export function useBranchCommands() {
  const scope = useRepositoryScope();
  const applyToRefs = useApplyToRefs();
  const options = { repository: scope };
  const create = useCommand(RepositoryBranchesHttpApi.create, {
    ...options,
    onSuccess: (branch) => applyToRefs((refs) => withBranch(refs, branch)),
  });
  const rename = useCommand(RepositoryBranchesHttpApi.rename, {
    ...options,
    onSuccess: ({ previousName, branch }) =>
      applyToRefs((refs) => withRenamedBranch(refs, previousName, branch)),
  });
  const remove = useCommand(RepositoryBranchesHttpApi.delete, {
    ...options,
    onSuccess: (deleted) =>
      applyToRefs((refs) => withoutDeletedBranches(refs, deleted)),
  });
  const setUpstream = useCommand(RepositoryBranchesHttpApi.setUpstream, {
    ...options,
    onSuccess: (branch) => applyToRefs((refs) => withBranch(refs, branch)),
  });
  if (scope === undefined || !scope.writable) return null;
  const target: OperationScope = {
    repositoryId: scope.repositoryId,
    worktreePath: scope.worktreePath,
  };
  return {
    create: (branch: BranchRequest<typeof RepositoryBranchesHttpApi.create>) =>
      settleCommand(RepositoryBranchesHttpApi.create, create.mutateAsync, {
        ...target,
        ...branch,
      }),
    rename: (branch: BranchRequest<typeof RepositoryBranchesHttpApi.rename>) =>
      settleCommand(RepositoryBranchesHttpApi.rename, rename.mutateAsync, {
        ...target,
        ...branch,
      }),
    delete: (branch: BranchRequest<typeof RepositoryBranchesHttpApi.delete>) =>
      settleCommand(RepositoryBranchesHttpApi.delete, remove.mutateAsync, {
        ...target,
        ...branch,
      }),
    setUpstream: (
      branch: BranchRequest<typeof RepositoryBranchesHttpApi.setUpstream>,
    ) =>
      settleCommand(
        RepositoryBranchesHttpApi.setUpstream,
        setUpstream.mutateAsync,
        {
          ...target,
          ...branch,
        },
      ),
  };
}
