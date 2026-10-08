import { skipToken } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  type BranchDeletion,
  type BranchUpstreamTarget,
  RepositoryBranchesApi,
  type UnmergedBranch,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type {
  LocalBranch,
  RemoteBranch,
  RepositoryRefs,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import {
  type RefKind,
  refFailureMessages,
} from "#web/features/refs/ref-kinds.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

type Targeted<Ref> = Ref & { readonly target: string };

export interface BranchTarget {
  readonly local?: Targeted<LocalBranch>;
  readonly remote?: Targeted<RemoteBranch>;
}

type BranchesDeletion = Extract<RefDeletion, { kind: "branch" }>;

export type RefDeletion =
  | { readonly kind: "branch"; readonly branches: readonly BranchTarget[] }
  | {
      readonly kind: "tag";
      readonly name: string;
      readonly local?: { readonly object: string };
      readonly remote?: { readonly remote: string; readonly object: string };
    };

interface PendingDeletion {
  readonly deletion: RefDeletion;
  readonly busy: boolean;
  readonly unmerged?: readonly UnmergedBranch[];
  readonly earlier?: DeletedBranches;
}

interface DeletedBranches {
  readonly names: readonly string[];
  readonly restorable: readonly DeletedBranch[] | undefined;
}

interface DeletedBranch {
  readonly name: string;
  readonly target: string;
  readonly track?: BranchUpstreamTarget;
}

export function useRefDeletion({
  refs,
  focusTree,
  reveal,
}: {
  readonly refs: RepositoryRefs | undefined;
  readonly focusTree: () => void;
  readonly reveal: (kind: RefKind, name: string) => void;
}) {
  const createBranch = useCommand(RepositoryBranchesApi.create);
  const deletes = {
    branch: useCommand(RepositoryBranchesApi.delete),
    tag: useCommand(RepositoryTagsApi.delete),
  };
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const scope = useRepositoryScope();
  const [pending, setPendingState] = useState<PendingDeletion>();
  const asked =
    pending?.deletion.kind === "branch" && pending.unmerged === undefined
      ? pending.deletion
      : undefined;
  const preview = useEnvironmentQuery(
    RepositoryBranchesApi.unmerged,
    asked === undefined || scope === undefined
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          branches: asked.branches.map(branchDeletionInput),
        },
    { changes: "refs", enabled: pending?.busy !== true },
  );
  const unmerged =
    pending?.unmerged ?? (asked === undefined ? undefined : preview.data);
  const latestPending = useRef(pending);
  const setPending = (next: PendingDeletion | undefined) => {
    latestPending.current = next;
    setPendingState(next);
  };

  const cancel = () => {
    setPending(undefined);
    focusTree();
  };

  const remove = async (
    deletion: RefDeletion,
    force: boolean,
    earlier: DeletedBranches = { names: [], restorable: [] },
  ) => {
    const next =
      deletion.kind === "tag"
        ? await removeTag(deletion)
        : await removeBranches(deletion, force, earlier);
    if (next !== undefined) {
      setPending(next);
      return;
    }
    const current = latestPending.current;
    if (current !== undefined && current.deletion !== deletion) return;
    setPending(undefined);
    focusTree();
  };

  const removeTag = async (deletion: Extract<RefDeletion, { kind: "tag" }>) => {
    const result = await deletes.tag.run(tagDeletionInput(deletion));
    if (result._tag !== "Ok")
      errorToast.failure(
        "deleteTag",
        result,
        refFailureMessages(deletion.name),
      );
    else statusToast.success("deleteTag", `Deleted ${deletion.name}`);
    return undefined;
  };

  const removeBranches = async (
    deletion: BranchesDeletion,
    force: boolean,
    earlier: DeletedBranches,
  ): Promise<PendingDeletion | undefined> => {
    const result = await deletes.branch.run({
      branches: deletion.branches.map(branchDeletionInput),
      force,
    });
    const [first] = deletion.branches;
    const messages = refFailureMessages(
      first === undefined ? "" : branchLabel(first),
    );
    if (result._tag !== "Ok") {
      errorToast.failure("deleteBranch", result, messages);
      return undefined;
    }
    const { deleted, unmerged, failure } = result.value;
    const among = (list: readonly BranchDeletion[]) =>
      deletion.branches.filter((branch) =>
        list.some((other) => sameBranch(branchDeletionInput(branch), other)),
      );
    const removed = among(deleted);
    const now = deletedBranches(removed, refs);
    const done: DeletedBranches = {
      names: [...earlier.names, ...removed.map(branchLabel)],
      restorable:
        now === undefined || earlier.restorable === undefined
          ? undefined
          : [...earlier.restorable, ...now],
    };
    const restorable = done.restorable ?? [];
    const undoable =
      restorable.length === 0 ? undefined : () => void undo(restorable);
    const [only] = done.names;
    if (failure !== undefined)
      errorToast.failure(
        "deleteBranch",
        { _tag: "Rejected", failure },
        messages,
        undoable,
      );
    else if (removed.length > 0)
      statusToast.success(
        "deleteBranch",
        done.names.length === 1 && only !== undefined
          ? `Deleted ${only}`
          : `Deleted ${done.names.length} branches`,
        undoable,
      );
    const kept = among(unmerged.map(({ branch }) => branch));
    return kept.length === 0
      ? undefined
      : {
          deletion: { kind: "branch", branches: kept },
          busy: false,
          unmerged,
          earlier: done,
        };
  };

  const undo = async (deleted: readonly DeletedBranch[]) => {
    if (!createBranch.canRun) return;
    const restored = await Promise.all(
      deleted.map((branch) =>
        createBranch.run({
          name: branch.name,
          startPoint: branch.target,
          ...(branch.track === undefined ? {} : { track: branch.track }),
        }),
      ),
    );
    const failed = restored.findIndex((result) => result._tag !== "Ok");
    const failure = restored[failed];
    const [first] = deleted;
    if (failure !== undefined && failure._tag !== "Ok")
      errorToast.failure(
        "restoreBranch",
        failure,
        refFailureMessages(deleted[failed]?.name ?? ""),
      );
    else if (first !== undefined) reveal("branch", first.name);
  };

  return {
    pending: pending === undefined ? undefined : { ...pending, unmerged },
    cancel,
    request: (deletion: RefDeletion) => {
      if (confirmsFirst(deletion)) setPending({ deletion, busy: false });
      else if (deletes[deletion.kind].canRun) void remove(deletion, false);
    },
    confirm: () => {
      if (pending === undefined || pending.busy) return;
      if (!deletes[pending.deletion.kind].canRun) {
        cancel();
        return;
      }
      setPending({ ...pending, busy: true });
      void remove(
        pending.deletion,
        unmerged !== undefined && unmerged.length > 0,
        pending.earlier,
      );
    },
  };
}

export function deletionTitle(deletion: RefDeletion) {
  if (deletion.kind === "tag") return `Delete tag ${deletion.name}?`;
  const { branches } = deletion;
  const [only] = branches;
  return branches.length === 1 && only !== undefined
    ? `Delete ${branchLabel(only)}?`
    : `Delete ${branches.length} branches?`;
}

function branchLabel({
  local,
  remote,
}: Pick<BranchDeletion, "local" | "remote">) {
  return local?.name ?? remote?.name ?? "";
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
  return (
    deletion.kind === "tag" ||
    deletion.branches.some((branch) => branch.remote !== undefined)
  );
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

function branchDeletionInput({ local, remote }: BranchTarget): BranchDeletion {
  return {
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

function sameBranch(left: BranchDeletion, right: BranchDeletion) {
  return (
    left.local?.name === right.local?.name &&
    left.remote?.remote === right.remote?.remote &&
    left.remote?.name === right.remote?.name
  );
}

function deletedBranches(
  branches: readonly BranchTarget[],
  refs: RepositoryRefs | undefined,
): readonly DeletedBranch[] | undefined {
  const restorable = branches.flatMap(({ local, remote }) =>
    local === undefined || remote !== undefined ? [] : [local],
  );
  if (restorable.length === 0 || restorable.length !== branches.length)
    return undefined;
  return restorable.map((local) => {
    const track =
      refs === undefined
        ? undefined
        : upstreamTarget(refs, local.upstream?.name);
    return {
      name: local.name,
      target: local.target,
      ...(track === undefined ? {} : { track }),
    };
  });
}
