import type { BranchUpstreamTarget, RepositoryRefs } from "@rebase/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  type BranchCommandFailure,
  type BranchCreateRequest,
  useBranchCommands,
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

export interface BranchRename {
  readonly name: string;
  readonly newName: string;
}

export function useBranchEditing({
  activeWorktreePath,
  createRequest,
  focusTree,
  onCreated,
  onRenamed,
  refs,
  reveal,
}: {
  readonly activeWorktreePath: string;
  readonly createRequest: BranchCreateRequest | undefined;
  readonly focusTree: () => void;
  readonly onCreated: (branchName: string) => void;
  readonly onRenamed: (rename: BranchRename) => void;
  readonly refs: RepositoryRefs | undefined;
  readonly reveal: (branchName: string) => void;
}) {
  const commands = useBranchCommands();
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
      : branchRowActions(row, refs, activeWorktreePath, commands !== null);

  const cancel = useCallback(() => {
    setEdit(undefined);
    focusTree();
  }, [focusTree]);

  const deletion = useBranchDeletion({
    commands,
    focusTree,
    refs,
    reportError: setError,
    reveal,
  });

  const finish = (name: string) => {
    setEdit(undefined);
    reveal(name);
  };

  const run = async (
    write: () => Promise<BranchCommandFailure | undefined>,
  ) => {
    const failure = await write();
    return failure === undefined ? undefined : describeBranchError(failure);
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
        if (commands === null || edit?.kind !== "create") return undefined;
        const { oid, track } = edit.startPoint;
        const created = await commands.create({
          name,
          startPoint: oid,
          ...(track === undefined ? {} : { track }),
        });
        if (created._tag === "Failed") return created.failure;
        finish(name);
        onCreated(name);
        return undefined;
      }),
    deletion,
    dismissError: () => setError(undefined),
    edit,
    error,
    handleTreeKey,
    renameBranch: (newName: string) =>
      run(async () => {
        if (commands === null || edit?.kind !== "rename") return undefined;
        const { name, target } = edit.branch;
        if (newName !== name) {
          const renamed = await commands.rename({
            ...(target === undefined ? {} : { expectedTarget: target }),
            name,
            newName,
          });
          if (renamed._tag === "Failed") return renamed.failure;
          onRenamed({ name, newName });
        }
        finish(newName);
        return undefined;
      }),
    rowActions,
    setUpstream: async (upstream: BranchUpstreamTarget | null) => {
      if (commands === null || edit?.kind !== "upstream") return;
      const { name } = edit.branch;
      const result = await commands.setUpstream({ name, upstream });
      if (result._tag === "Ok") reveal(name);
      else setError(describeBranchError(result.failure));
    },
    start,
  };
}
