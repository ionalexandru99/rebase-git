import {
  type BranchUpstreamTarget,
  RepositoryBranchesHttpApi,
  type RepositoryRefs,
} from "@rebase/contracts";
import { useCallback, useEffect, useState } from "react";
import type { BranchEdit } from "#web/features/branches-sidebar/branch-editing/branch-edit-state";
import {
  branchDeletion,
  branchRowActions,
  branchStartPoint,
  localBranch,
} from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import {
  type BranchCommandFailure,
  describeBranchFailure,
  useBranchDeletion,
} from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-deletion";
import {
  type BranchesSidebarRefRow,
  type BranchesSidebarRow,
  localBranchesSectionId,
} from "#web/features/branches-sidebar/branches-sidebar-model";
import type { RefCreateRequest } from "#web/features/branches-sidebar/hooks/use-create-ref-here";
import { useCommand } from "#web/platform/query/use-command";

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
  readonly createRequest: RefCreateRequest | undefined;
  readonly focusTree: () => void;
  readonly onCreated: (branchName: string) => void;
  readonly onRenamed: (rename: BranchRename) => void;
  readonly refs: RepositoryRefs | undefined;
  readonly reveal: (branchName: string) => void;
}) {
  const commands = {
    create: useCommand(RepositoryBranchesHttpApi.create),
    rename: useCommand(RepositoryBranchesHttpApi.rename),
    delete: useCommand(RepositoryBranchesHttpApi.delete),
    setUpstream: useCommand(RepositoryBranchesHttpApi.setUpstream),
  };
  const [edit, setEdit] = useState<BranchEdit>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (createRequest === undefined) return;
    setError(undefined);
    setEdit(
      createRequest.kind === "branch" ? draftAt(createRequest.oid) : undefined,
    );
  }, [createRequest]);

  const rowActions = (row: BranchesSidebarRefRow) =>
    refs === undefined
      ? []
      : branchRowActions(row, refs, activeWorktreePath, commands.create.canRun);

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
    return failure === undefined ? undefined : describeBranchFailure(failure);
  };

  const start = (id: string, row: BranchesSidebarRefRow) => {
    if (refs === undefined) return;
    const action = rowActions(row).find((candidate) => candidate.id === id);
    if (action === undefined || action.disabledReason !== undefined) return;
    setError(undefined);
    if (action.id === "newBranch") {
      const startPoint = branchStartPoint(row, refs);
      if (startPoint !== undefined) setEdit({ kind: "create", startPoint });
      return;
    }
    if (action.id === "rename" || action.id === "upstream") {
      const branch = localBranch(row, refs);
      if (branch !== undefined)
        setEdit({ branch, kind: action.id, rowId: row.id });
      return;
    }
    const target = branchDeletion(action.id, row, refs);
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
        if (!commands.create.canRun || edit?.kind !== "create")
          return undefined;
        const { oid, track } = edit.startPoint;
        const created = await commands.create.run({
          name,
          startPoint: oid,
          ...(track === undefined ? {} : { track }),
        });
        if (created._tag !== "Ok") return created;
        finish(name);
        onCreated(name);
        return undefined;
      }),
    deletion,
    dismissError: () => setError(undefined),
    draftSectionId:
      edit?.kind === "create" ? localBranchesSectionId : undefined,
    edit,
    error,
    handleTreeKey,
    renameBranch: (newName: string) =>
      run(async () => {
        if (!commands.rename.canRun || edit?.kind !== "rename")
          return undefined;
        const { name, target } = edit.branch;
        if (newName !== name) {
          const renamed = await commands.rename.run({
            ...(target === undefined ? {} : { expectedTarget: target }),
            name,
            newName,
          });
          if (renamed._tag !== "Ok") return renamed;
          onRenamed({ name, newName });
        }
        finish(newName);
        return undefined;
      }),
    rowActions,
    setUpstream: async (upstream: BranchUpstreamTarget | null) => {
      if (!commands.setUpstream.canRun || edit?.kind !== "upstream") return;
      const { name } = edit.branch;
      const result = await commands.setUpstream.run({ name, upstream });
      if (result._tag === "Ok") reveal(name);
      else setError(describeBranchFailure(result));
    },
    start,
  };
}

function draftAt(oid: string): BranchEdit {
  return {
    kind: "create",
    startPoint: { label: oid.slice(0, 7), name: "", oid },
  };
}
