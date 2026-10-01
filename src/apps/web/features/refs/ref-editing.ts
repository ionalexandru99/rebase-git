import { useCallback, useRef, useState } from "react";
import {
  type BranchNotMerged,
  type BranchUpstreamTarget,
  RepositoryBranchesApi,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type {
  LocalBranch,
  RemoteBranch,
  RepositoryRefs,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  type ErrorAction,
  useErrorToast,
} from "#web/features/notifications/notifications.tsx";
import {
  namingFailure,
  type RefKind,
  type RefRoute,
  refFailureMessages,
  type StartPoint,
} from "#web/features/refs/ref-kinds.ts";
import { rejection } from "#web/platform/query/request-failure.ts";
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

type Targeted<Ref> = Ref & { readonly target: string };

export type RefDeletion =
  | {
      readonly kind: "branch";
      readonly local?: Targeted<LocalBranch>;
      readonly remote?: Targeted<RemoteBranch>;
    }
  | {
      readonly kind: "tag";
      readonly name: string;
      readonly local?: { readonly object: string };
      readonly remote?: { readonly remote: string; readonly object: string };
    };

interface PendingDeletion {
  readonly deletion: RefDeletion;
  readonly busy: boolean;
  readonly failure?: BranchNotMerged;
}

interface DeletedBranch {
  readonly name: string;
  readonly target: string;
  readonly track?: BranchUpstreamTarget;
}

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
  readonly reveal: (kind: RefKind, name: string) => void;
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
  const deletes = {
    branch: useCommand(RepositoryBranchesApi.delete),
    tag: useCommand(RepositoryTagsApi.delete),
  };
  const renameBranch = useCommand(RepositoryBranchesApi.rename);
  const errorToast = useErrorToast();
  const [edit, setEdit] = useState<RefEdit>();
  const [pending, setPending] = useState<PendingDeletion>();
  const [deleted, setDeleted] = useState<DeletedBranch>();
  const [notice, setNotice] = useState<string>();
  const latestPending = useRef(pending);
  latestPending.current = pending;

  const cancel = useCallback(() => {
    setEdit(undefined);
    focusTree();
  }, [focusTree]);

  const cancelDeletion = useCallback(() => {
    setPending(undefined);
    focusTree();
  }, [focusTree]);

  const dismiss = useCallback(() => setDeleted(undefined), []);

  const begin = (next: RefEdit) => {
    setNotice(undefined);
    setEdit(next);
  };

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

  const finish = (kind: RefKind, name: string) => {
    setEdit(undefined);
    reveal(kind, name);
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
    const { name, target } = edit.branch;
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
    finish("branch", newName);
    return undefined;
  };

  const remove = async (deletion: RefDeletion, force: boolean) => {
    const result =
      deletion.kind === "tag"
        ? await deletes.tag.run(tagDeletionInput(deletion))
        : await deletes.branch.run(branchDeletionInput(deletion, force));
    const unmerged =
      force || result._tag === "Ok" ? undefined : notMerged(result);
    if (unmerged !== undefined) {
      setPending({ deletion, busy: false, failure: unmerged });
      return;
    }
    if (result._tag !== "Ok")
      errorToast.failure(
        deletion.kind === "tag" ? "deleteTag" : "deleteBranch",
        result,
        refFailureMessages(deletedName(deletion)),
      );
    else {
      const restorable = deletedBranch(deletion, refs);
      if (restorable !== undefined) setDeleted(restorable);
      setNotice(remoteDeletionNotice(deletion));
    }
    const current = latestPending.current;
    if (current !== undefined && current.deletion !== deletion) return;
    setPending(undefined);
    focusTree();
  };

  const undo = async () => {
    if (!creates.branch.canRun || deleted === undefined) return;
    setDeleted(undefined);
    const restored = await creates.branch.run({
      name: deleted.name,
      startPoint: deleted.target,
      ...(deleted.track === undefined ? {} : { track: deleted.track }),
    });
    if (restored._tag === "Ok") reveal("branch", deleted.name);
    else
      errorToast.failure(
        "restoreBranch",
        restored,
        refFailureMessages(deleted.name),
      );
  };

  return {
    edit,
    notice,
    dismissNotice: () => setNotice(undefined),
    writable: creates.branch.canRun,
    cancel,
    create,
    rename,
    draft: (kind: RefKind, startPoint: StartPoint) =>
      begin({ kind: "create", ref: kind, startPoint }),
    startRename: (branch: LocalBranch, rowId: string) =>
      begin({ kind: "rename", branch, rowId }),
    deletion: {
      pending,
      deleted,
      cancel: cancelDeletion,
      dismiss,
      undo: () => void undo(),
      request: (deletion: RefDeletion) => {
        setNotice(undefined);
        if (confirmsFirst(deletion)) setPending({ deletion, busy: false });
        else if (deletes[deletion.kind].canRun) void remove(deletion, false);
      },
      confirm: () => {
        if (pending === undefined || pending.busy) return;
        if (!deletes[pending.deletion.kind].canRun) {
          cancelDeletion();
          return;
        }
        setPending({ ...pending, busy: true });
        void remove(pending.deletion, pending.failure !== undefined);
      },
    },
  };
}

export function deletionTitle(deletion: RefDeletion) {
  if (deletion.kind === "tag") {
    const { name, local, remote } = deletion;
    if (remote === undefined) return `Delete tag ${name}?`;
    if (local === undefined) return `Delete tag ${name} on ${remote.remote}?`;
    return `Delete tag ${name} locally and on ${remote.remote}?`;
  }
  const { local, remote } = deletion;
  if (remote === undefined) return `Delete ${local?.name ?? ""}?`;
  if (local === undefined) return `Delete ${remote.name} on ${remote.remote}?`;
  return `Delete ${local.name} locally and on ${remote.remote}?`;
}

function upstreamTarget(
  refs: RepositoryRefs,
  upstreamName: string | undefined,
): BranchUpstreamTarget | undefined {
  const branch = refs.remoteBranches.find(
    ({ name, remote }) => `${remote}/${name}` === upstreamName,
  );
  return branch === undefined
    ? undefined
    : { name: branch.name, remote: branch.remote };
}

function remoteDeletionNotice(deletion: RefDeletion) {
  if (deletion.kind !== "tag" || deletion.remote === undefined)
    return undefined;
  return deletion.local === undefined
    ? `Deleted ${deletion.name} on ${deletion.remote.remote}`
    : `Deleted ${deletion.name} locally and on ${deletion.remote.remote}`;
}

function confirmsFirst(deletion: RefDeletion) {
  return deletion.kind === "tag" || deletion.remote !== undefined;
}

function deletedName(deletion: RefDeletion) {
  return deletion.kind === "tag"
    ? deletion.name
    : (deletion.local?.name ?? deletion.remote?.name ?? "");
}

function tagDeletionInput({
  name,
  local,
  remote,
}: Extract<RefDeletion, { kind: "tag" }>) {
  return {
    name,
    ...(local === undefined ? {} : { local }),
    ...(remote === undefined ? {} : { remote }),
  };
}

function branchDeletionInput(
  { local, remote }: Extract<RefDeletion, { kind: "branch" }>,
  force: boolean,
) {
  return {
    force,
    ...(local === undefined
      ? {}
      : { local: { name: local.name, target: local.target } }),
    ...(remote === undefined
      ? {}
      : {
          remote: {
            name: remote.name,
            remote: remote.remote,
            target: remote.target,
          },
        }),
  };
}

function deletedBranch(
  deletion: RefDeletion,
  refs: RepositoryRefs | undefined,
): DeletedBranch | undefined {
  if (deletion.kind !== "branch" || deletion.remote !== undefined)
    return undefined;
  const { local } = deletion;
  if (local === undefined) return undefined;
  const track =
    refs === undefined ? undefined : upstreamTarget(refs, local.upstream?.name);
  return {
    name: local.name,
    target: local.target,
    ...(track === undefined ? {} : { track }),
  };
}

function notMerged(failure: CommandFailure<RefRoute>) {
  const rejected = rejection(failure);
  return rejected?._tag === "BranchNotMerged" ? rejected : undefined;
}
