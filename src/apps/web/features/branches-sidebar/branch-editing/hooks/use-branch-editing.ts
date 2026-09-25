import type { BranchUpstreamTarget, RepositoryRefs } from "@rebase/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  useBranchActions,
  useBranchCreateRequest,
} from "#web/features/branch-management/index";
import { describeBranchError } from "#web/features/branches-sidebar/branch-editing/branch-edit-messages";
import type { BranchEdit } from "#web/features/branches-sidebar/branch-editing/branch-edit-state";
import {
  type BranchRowActionId,
  branchDeletion,
  branchRowActions,
  branchStartPoint,
  localBranch,
} from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import { useBranchDeletion } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-deletion";
import type {
  BranchesSidebarRefRow,
  BranchesSidebarRow,
} from "#web/features/branches-sidebar/branches-sidebar.contract";

export type BranchEditing = ReturnType<typeof useBranchEditing>;

export function useBranchEditing({
  activeWorktreePath,
  focusTree,
  refs,
  reveal,
}: {
  readonly activeWorktreePath: string;
  readonly focusTree: () => void;
  readonly refs: RepositoryRefs | undefined;
  readonly reveal: (branchName: string) => void;
}) {
  const actions = useBranchActions();
  const createRequest = useBranchCreateRequest();
  const [edit, setEdit] = useState<BranchEdit>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (createRequest === undefined) return;
    setError(undefined);
    setEdit({
      kind: "create",
      startPoint: {
        label: createRequest.oid.slice(0, 7),
        name: "",
        oid: createRequest.oid,
      },
    });
  }, [createRequest]);

  const rowActions = (row: BranchesSidebarRefRow) =>
    refs === undefined
      ? []
      : branchRowActions(row, refs, activeWorktreePath, actions !== undefined);

  const cancel = useCallback(() => {
    setEdit(undefined);
    focusTree();
  }, [focusTree]);

  const deletion = useBranchDeletion({
    actions,
    focusTree,
    refs,
    reportError: setError,
    reveal,
  });

  const finish = (name: string) => {
    setEdit(undefined);
    reveal(name);
  };

  const run = async (write: () => Promise<void>) => {
    try {
      await write();
      return undefined;
    } catch (failure) {
      return describeBranchError(failure);
    }
  };

  const start = (id: BranchRowActionId, row: BranchesSidebarRefRow) => {
    if (refs === undefined) return;
    const action = rowActions(row).find((candidate) => candidate.id === id);
    if (action === undefined || action.disabledReason !== undefined) return;
    setError(undefined);
    if (id === "newBranch") {
      const startPoint = branchStartPoint(row, refs);
      if (startPoint !== undefined) setEdit({ kind: "create", startPoint });
      return;
    }
    if (id === "rename" || id === "upstream") {
      const branch = localBranch(row, refs);
      if (branch !== undefined) setEdit({ branch, kind: id, rowId: row.id });
      return;
    }
    const target = branchDeletion(id, row, refs);
    if (target !== undefined) deletion.request(target);
  };

  const handleTreeKey = (key: string, row: BranchesSidebarRow | undefined) => {
    if (row?.kind !== "ref" || row.target._tag !== "LocalBranch") return false;
    if (key === "F2") start("rename", row);
    else if (key === "Delete" || key === "Backspace") start("delete", row);
    else return false;
    return true;
  };

  return {
    cancel,
    createBranch: (name: string) =>
      run(async () => {
        if (actions === undefined || edit?.kind !== "create") return;
        const { oid, track } = edit.startPoint;
        await actions.create({
          checkout: true,
          name,
          startPoint: oid,
          ...(track === undefined ? {} : { track }),
        });
        finish(name);
      }),
    deletion,
    dismissError: () => setError(undefined),
    edit,
    error,
    handleTreeKey,
    renameBranch: (newName: string) =>
      run(async () => {
        if (actions === undefined || edit?.kind !== "rename") return;
        if (newName !== edit.branch.name)
          await actions.rename({
            ...(edit.branch.target === undefined
              ? {}
              : { expectedTarget: edit.branch.target }),
            name: edit.branch.name,
            newName,
          });
        finish(newName);
      }),
    rowActions,
    setUpstream: async (upstream: BranchUpstreamTarget | null) => {
      if (actions === undefined || edit?.kind !== "upstream") return;
      const { name } = edit.branch;
      const message = await run(() => actions.setUpstream({ name, upstream }));
      if (message === undefined) reveal(name);
      else setError(message);
    },
    start,
  };
}
