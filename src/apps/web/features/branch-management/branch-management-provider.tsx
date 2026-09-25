import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type {
  BranchCreateRequest,
  BranchRename,
} from "#web/features/branch-management/branch-management.contract";
import { createBranchWrites } from "#web/features/branch-management/branch-writes";
import {
  createRepositoryBranches,
  type RepositoryBranches,
} from "#web/features/branch-management/repository-branches";
import { repositoryBranchesClient } from "#web/features/branch-management/repository-branches-client";
import type { RepositoryRefsController } from "#web/features/repository-refs/index";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useStore } from "#web/platform/store/use-store";

const BranchManagementContext = createContext<RepositoryBranches | null>(null);

export function BranchManagementProvider({
  refs,
  children,
}: {
  readonly refs: Pick<RepositoryRefsController, "apply" | "checkout">;
  readonly children: ReactNode;
}) {
  const scope = useRepositoryScope();
  const target = scope?.target;
  const writable = scope?.writable ?? false;
  const branches = useMemo(
    () =>
      target === undefined || !writable
        ? null
        : createRepositoryBranches(
            createBranchWrites(repositoryBranchesClient(target.requests), refs),
            refs,
            {
              repositoryId: target.repositoryId,
              worktreePath: target.worktreePath,
            },
          ),
    [target, writable, refs],
  );
  return (
    <BranchManagementContext.Provider value={branches}>
      {children}
    </BranchManagementContext.Provider>
  );
}

const idleStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
};

export function useBranchManagement() {
  const branches = useContext(BranchManagementContext);
  const createRequest = useStore<BranchCreateRequest | undefined>(
    branches?.createRequest ?? idleStore,
  );
  return branches === null
    ? undefined
    : {
        actions: branches.actions,
        createRequest,
        requestCreate: branches.requestCreate,
      };
}

export function useBranchRenamed(listener: (rename: BranchRename) => void) {
  const branches = useContext(BranchManagementContext);
  useEffect(() => branches?.onRenamed(listener), [branches, listener]);
}
