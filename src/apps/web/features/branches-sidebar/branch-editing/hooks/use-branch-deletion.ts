import type {
  BranchNotMerged,
  BranchUpstreamTarget,
  RepositoryRefs,
} from "@rebase/contracts";
import { useCallback, useState } from "react";
import type {
  BranchCommandFailure,
  BranchCommands,
} from "#web/features/branch-management/hooks/use-branch-commands";
import { describeBranchError } from "#web/features/branches-sidebar/branch-editing/branch-edit-messages";
import {
  type BranchDeletion,
  upstreamTarget,
} from "#web/features/branches-sidebar/branch-editing/branch-row-actions";

export interface DeletedBranch {
  readonly name: string;
  readonly target: string;
  readonly track?: BranchUpstreamTarget;
}

export interface PendingDeletion {
  readonly busy?: boolean;
  readonly deletion: BranchDeletion;
  readonly failure?: BranchNotMerged;
}

export function useBranchDeletion({
  commands,
  focusTree,
  refs,
  reportError,
  reveal,
}: {
  readonly commands: BranchCommands | null;
  readonly focusTree: () => void;
  readonly refs: RepositoryRefs | undefined;
  readonly reportError: (message: string | undefined) => void;
  readonly reveal: (branchName: string) => void;
}) {
  const [pending, setPending] = useState<PendingDeletion>();
  const [deleted, setDeleted] = useState<DeletedBranch>();

  const remove = async (deletion: BranchDeletion, force: boolean) => {
    if (commands === null) return;
    reportError(undefined);
    const { local, remote } = deletion;
    const result = await commands.delete({
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
    });
    if (result._tag === "Ok") {
      setPending(undefined);
      if (local !== undefined && remote === undefined)
        setDeleted(deletedBranch(local, refs));
      focusTree();
      return;
    }
    const unmerged = force ? undefined : notMerged(result.failure);
    if (unmerged !== undefined) {
      setPending({ deletion, failure: unmerged });
      return;
    }
    setPending(undefined);
    reportError(describeBranchError(result.failure));
  };

  const cancel = useCallback(() => {
    setPending(undefined);
    focusTree();
  }, [focusTree]);

  const dismiss = useCallback(() => setDeleted(undefined), []);

  return {
    cancel,
    confirm: () => {
      if (pending === undefined || pending.busy === true) return;
      setPending({ ...pending, busy: true });
      void remove(pending.deletion, pending.failure !== undefined);
    },
    deleted,
    dismiss,
    pending,
    request: (deletion: BranchDeletion) => {
      if (deletion.remote === undefined) void remove(deletion, false);
      else setPending({ deletion });
    },
    undo: async () => {
      if (commands === null || deleted === undefined) return;
      setDeleted(undefined);
      const restored = await commands.create({
        name: deleted.name,
        startPoint: deleted.target,
        ...(deleted.track === undefined ? {} : { track: deleted.track }),
      });
      if (restored._tag === "Ok") reveal(deleted.name);
      else reportError(describeBranchError(restored.failure));
    },
  };
}

function notMerged(failure: BranchCommandFailure) {
  return failure._tag === "EnvironmentHttpRejected" &&
    failure.failure._tag === "BranchNotMerged"
    ? failure.failure
    : undefined;
}

function deletedBranch(
  local: NonNullable<BranchDeletion["local"]>,
  refs: RepositoryRefs | undefined,
): DeletedBranch {
  const track =
    refs === undefined ? undefined : upstreamTarget(refs, local.upstream?.name);
  return {
    name: local.name,
    target: local.target,
    ...(track === undefined ? {} : { track }),
  };
}
