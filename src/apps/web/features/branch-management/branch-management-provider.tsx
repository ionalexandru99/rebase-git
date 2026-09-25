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
import { createBranchHereCommand } from "#web/features/branch-management/create-branch-here-command";
import {
  createRepositoryBranches,
  type RepositoryBranches,
} from "#web/features/branch-management/repository-branches";
import { repositoryBranchesClient } from "#web/features/branch-management/repository-branches-client";
import { GraphCommands } from "#web/features/commit-commands/index";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useStore } from "#web/platform/store/use-store";

const BranchManagementContext = createContext<RepositoryBranches | null>(null);

export function BranchManagementProvider({
  children,
}: {
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
            createBranchWrites(
              repositoryBranchesClient(target.requests),
              target.refs,
            ),
            target.refs,
            {
              repositoryId: target.repositoryId,
              worktreePath: target.worktreePath,
            },
          ),
    [target, writable],
  );
  const graphCommands = useMemo(
    () =>
      branches === null
        ? []
        : [createBranchHereCommand(branches.requestCreate)],
    [branches],
  );
  return (
    <BranchManagementContext.Provider value={branches}>
      <GraphCommands.Contribute commands={graphCommands}>
        {children}
      </GraphCommands.Contribute>
    </BranchManagementContext.Provider>
  );
}

const idleStore = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
};

export function useBranchActions() {
  return useContext(BranchManagementContext)?.actions;
}

export function useBranchCreateRequest() {
  const branches = useContext(BranchManagementContext);
  return useStore<BranchCreateRequest | undefined>(
    branches?.createRequest ?? idleStore,
  );
}

export function useBranchRenamed(listener: (rename: BranchRename) => void) {
  const branches = useContext(BranchManagementContext);
  useEffect(() => branches?.onRenamed(listener), [branches, listener]);
}
