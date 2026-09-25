import type {
  BranchNotMerged,
  BranchUpstreamTarget,
  RepositoryRefs,
} from "@rebase/contracts";
import { useCallback, useState } from "react";
import {
  type BranchActions,
  RepositoryBranchesRejected,
} from "#web/features/branch-management/index";
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
  actions,
  focusTree,
  refs,
  reportError,
  reveal,
}: {
  readonly actions: BranchActions | undefined;
  readonly focusTree: () => void;
  readonly refs: RepositoryRefs | undefined;
  readonly reportError: (message: string | undefined) => void;
  readonly reveal: (branchName: string) => void;
}) {
  const [pending, setPending] = useState<PendingDeletion>();
  const [deleted, setDeleted] = useState<DeletedBranch>();

  const remove = async (deletion: BranchDeletion, force: boolean) => {
    if (actions === undefined) return;
    reportError(undefined);
    const { local, remote } = deletion;
    try {
      await actions.delete({
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
      setPending(undefined);
      if (local !== undefined && remote === undefined)
        setDeleted(deletedBranch(local, refs));
      focusTree();
    } catch (failure) {
      if (
        !force &&
        failure instanceof RepositoryBranchesRejected &&
        failure.failure._tag === "BranchNotMerged"
      ) {
        setPending({ deletion, failure: failure.failure });
        return;
      }
      setPending(undefined);
      reportError(describeBranchError(failure));
    }
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
      if (actions === undefined || deleted === undefined) return;
      setDeleted(undefined);
      try {
        await actions.create({
          checkout: false,
          name: deleted.name,
          startPoint: deleted.target,
          ...(deleted.track === undefined ? {} : { track: deleted.track }),
        });
        reveal(deleted.name);
      } catch (failure) {
        reportError(describeBranchError(failure));
      }
    },
  };
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
