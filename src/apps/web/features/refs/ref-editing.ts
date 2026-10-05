import { useState } from "react";
import { RepositoryBranchesApi } from "#contracts/repository-refs/repository-branches.contract.ts";
import type {
  LocalBranch,
  RepositoryRefs,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  type ErrorAction,
  useErrorToast,
} from "#web/features/notifications/notifications.tsx";
import { useRefDeletion } from "#web/features/refs/ref-deletion.ts";
import {
  namingFailure,
  type RefKind,
  type RefRoute,
  refFailureMessages,
  type StartPoint,
} from "#web/features/refs/ref-kinds.ts";
import {
  type CommandFailure,
  useCommand,
} from "#web/platform/query/use-command.ts";

type RefEdit =
  | {
      readonly kind: "create";
      readonly ref: RefKind;
      readonly startPoint: StartPoint;
    }
  | {
      readonly kind: "rename";
      readonly branch: LocalBranch;
      readonly rowId: string;
    };

export type RefEditing = ReturnType<typeof useRefEditing>;

export function useRefEditing({
  refs,
  focusTree,
  reveal,
  onCreated,
  onRenamed,
}: {
  readonly refs: RepositoryRefs | undefined;
  readonly focusTree: () => void;
  readonly reveal: (kind: RefKind, name: string, settled?: boolean) => void;
  readonly onCreated: (branch: string) => void;
  readonly onRenamed: (rename: {
    readonly name: string;
    readonly newName: string;
  }) => void;
}) {
  const creates = {
    branch: useCommand(RepositoryBranchesApi.create),
    tag: useCommand(RepositoryTagsApi.create),
  };
  const renameBranch = useCommand(RepositoryBranchesApi.rename);
  const errorToast = useErrorToast();
  const [edit, setEdit] = useState<RefEdit>();

  const cancel = () => {
    setEdit(undefined);
    focusTree();
  };

  const begin = (next: RefEdit) => setEdit(next);

  const refused = (
    action: ErrorAction,
    name: string,
    failure: CommandFailure<RefRoute>,
  ) => {
    const naming = namingFailure(name, failure);
    if (naming === undefined)
      errorToast.failure(action, failure, refFailureMessages(name));
    return naming;
  };

  const finish = (kind: RefKind, name: string, settled?: boolean) => {
    setEdit(undefined);
    reveal(kind, name, settled);
  };

  const create = async (name: string, message?: string) => {
    if (edit?.kind !== "create") return undefined;
    const { ref, startPoint } = edit;
    if (!creates[ref].canRun) {
      cancel();
      return undefined;
    }
    const created =
      ref === "branch"
        ? await creates.branch.run({
            name,
            startPoint: startPoint.oid,
            ...(startPoint.track === undefined
              ? {}
              : { track: startPoint.track }),
          })
        : await creates.tag.run({
            name,
            target: startPoint.oid,
            ...(message === undefined ? {} : { message }),
          });
    if (created._tag !== "Ok")
      return refused(
        ref === "branch" ? "createBranch" : "createTag",
        name,
        created,
      );
    finish(ref, name);
    if (ref === "branch") onCreated(name);
    return undefined;
  };

  const rename = async (newName: string) => {
    if (!renameBranch.canRun || edit?.kind !== "rename") return undefined;
    const { name, settled, target } = edit.branch;
    if (newName !== name) {
      const renamed = await renameBranch.run({
        ...(target === undefined ? {} : { expectedTarget: target }),
        name,
        newName,
      });
      if (renamed._tag !== "Ok")
        return refused("renameBranch", newName, renamed);
      onRenamed({ name, newName });
    }
    finish("branch", newName, settled !== undefined);
    return undefined;
  };

  return {
    edit,
    writable: creates.branch.canRun,
    cancel,
    create,
    rename,
    draft: (kind: RefKind, startPoint: StartPoint) =>
      begin({ kind: "create", ref: kind, startPoint }),
    startRename: (branch: LocalBranch, rowId: string) =>
      begin({ kind: "rename", branch, rowId }),
    deletion: useRefDeletion({ refs, focusTree, reveal }),
  };
}
