import type { OperationScope } from "@rebase/contracts";
import type {
  BranchActions,
  BranchCreateRequest,
  BranchRename,
  BranchWrites,
} from "#web/features/branch-management/branch-management.contract";
import type { RepositoryRefsController } from "#web/features/repository-refs/index";
import { createStore } from "#web/platform/store/store";

export function createRepositoryBranches(
  writes: BranchWrites,
  refs: Pick<RepositoryRefsController, "checkout">,
  scope: OperationScope,
) {
  const createRequest = createStore<BranchCreateRequest | undefined>(undefined);
  const renameListeners = new Set<(rename: BranchRename) => void>();
  const actions: BranchActions = {
    create: async ({ checkout, ...branch }) => {
      await writes.create({ ...scope, ...branch });
      if (checkout)
        await refs
          .checkout(scope.worktreePath, {
            _tag: "LocalBranch",
            name: branch.name,
          })
          .catch(() => undefined);
    },
    delete: (branch) => writes.delete({ ...scope, ...branch }),
    rename: async (branch) => {
      await writes.rename({ ...scope, ...branch });
      for (const listener of renameListeners) listener(branch);
    },
    setUpstream: async (branch) => {
      await writes.setUpstream({ ...scope, ...branch });
    },
  };
  return {
    actions,
    createRequest,
    requestCreate: (oid: string) =>
      createRequest.set({
        oid,
        sequence: (createRequest.getSnapshot()?.sequence ?? 0) + 1,
      }),
    onRenamed: (listener: (rename: BranchRename) => void) => {
      renameListeners.add(listener);
      return () => {
        renameListeners.delete(listener);
      };
    },
  };
}

export type RepositoryBranches = ReturnType<typeof createRepositoryBranches>;
