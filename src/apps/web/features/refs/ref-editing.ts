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
  describeRefFailure,
  type RefKind,
  type RefRoute,
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
      readonly kind: "rename" | "upstream";
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
  | { readonly kind: "tag"; readonly name: string };

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
  const setBranchUpstream = useCommand(RepositoryBranchesApi.setUpstream);
  const [edit, setEdit] = useState<RefEdit>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<PendingDeletion>();
  const [deleted, setDeleted] = useState<DeletedBranch>();
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
    setError(undefined);
    setEdit(next);
  };

  const finish = (kind: RefKind, name: string) => {
    setEdit(undefined);
    reveal(kind, name);
  };

  const create = async (name: string) => {
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
        : await creates.tag.run({ name, target: startPoint.oid });
    if (created._tag !== "Ok") return describeRefFailure(name, created);
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
      if (renamed._tag !== "Ok") return describeRefFailure(newName, renamed);
      onRenamed({ name, newName });
    }
    finish("branch", newName);
    return undefined;
  };

  const setUpstream = async (upstream: BranchUpstreamTarget | null) => {
    if (!setBranchUpstream.canRun || edit?.kind !== "upstream") return;
    const { name } = edit.branch;
    const result = await setBranchUpstream.run({ name, upstream });
    if (result._tag === "Ok") reveal("branch", name);
    else setError(describeRefFailure(name, result));
  };

  const remove = async (deletion: RefDeletion, force: boolean) => {
    setError(undefined);
    const result =
      deletion.kind === "tag"
        ? await deletes.tag.run({ name: deletion.name })
        : await deletes.branch.run(branchDeletionInput(deletion, force));
    const unmerged =
      force || result._tag === "Ok" ? undefined : notMerged(result);
    if (unmerged !== undefined) {
      setPending({ deletion, busy: false, failure: unmerged });
      return;
    }
    if (result._tag !== "Ok")
      setError(describeRefFailure(deletedName(deletion), result));
    else {
      const restorable = deletedBranch(deletion, refs);
      if (restorable !== undefined) setDeleted(restorable);
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
    else setError(describeRefFailure(deleted.name, restored));
  };

  return {
    edit,
    error,
    writable: creates.branch.canRun,
    cancel,
    create,
    rename,
    setUpstream,
    draft: (kind: RefKind, startPoint: StartPoint) =>
      begin({ kind: "create", ref: kind, startPoint }),
    change: (kind: "rename" | "upstream", branch: LocalBranch, rowId: string) =>
      begin({ kind, branch, rowId }),
    deletion: {
      pending,
      deleted,
      cancel: cancelDeletion,
      dismiss,
      undo: () => void undo(),
      request: (deletion: RefDeletion) => {
        setError(undefined);
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
  if (deletion.kind === "tag") return `Delete tag ${deletion.name}?`;
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

function confirmsFirst(deletion: RefDeletion) {
  return deletion.kind === "tag" || deletion.remote !== undefined;
}

function deletedName(deletion: RefDeletion) {
  return deletion.kind === "tag"
    ? deletion.name
    : (deletion.local?.name ?? deletion.remote?.name ?? "");
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
