import type {
  BranchNotMerged,
  BranchUpstreamTarget,
  RepositoryBranchesHttpApi,
  RepositoryRefs,
} from "@rebase/contracts";
import { useCallback, useState } from "react";
import {
  type BranchDeletion,
  upstreamTarget,
} from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import {
  describeFailure,
  rejection,
} from "#web/platform/query/request-failure";
import type { Command, CommandFailure } from "#web/platform/query/use-command";

type BranchRoute =
  (typeof RepositoryBranchesHttpApi)[keyof typeof RepositoryBranchesHttpApi];

export type BranchCommandFailure = CommandFailure<BranchRoute>;

interface BranchCommands {
  readonly create: Command<typeof RepositoryBranchesHttpApi.create>;
  readonly delete: Command<typeof RepositoryBranchesHttpApi.delete>;
}

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
  readonly commands: BranchCommands;
  readonly focusTree: () => void;
  readonly refs: RepositoryRefs | undefined;
  readonly reportError: (message: string | undefined) => void;
  readonly reveal: (branchName: string) => void;
}) {
  const [pending, setPending] = useState<PendingDeletion>();
  const [deleted, setDeleted] = useState<DeletedBranch>();

  const remove = async (deletion: BranchDeletion, force: boolean) => {
    if (!commands.delete.canRun) return;
    reportError(undefined);
    const { local, remote } = deletion;
    const result = await commands.delete.run({
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
    const unmerged = force ? undefined : notMerged(result);
    if (unmerged !== undefined) {
      setPending({ deletion, failure: unmerged });
      return;
    }
    setPending(undefined);
    reportError(describeBranchFailure(result));
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
      if (!commands.create.canRun || deleted === undefined) return;
      setDeleted(undefined);
      const restored = await commands.create.run({
        name: deleted.name,
        startPoint: deleted.target,
        ...(deleted.track === undefined ? {} : { track: deleted.track }),
      });
      if (restored._tag === "Ok") reveal(deleted.name);
      else reportError(describeBranchFailure(restored));
    },
  };
}

function notMerged(failure: BranchCommandFailure) {
  const rejected = rejection(failure);
  return rejected?._tag === "BranchNotMerged" ? rejected : undefined;
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

export function describeBranchFailure(failure: BranchCommandFailure) {
  return describeFailure(failure, {
    InvalidBranchName: ({ name }) => `${name} is not a valid branch name.`,
    BranchExists: ({ name }) => `${name} already exists.`,
    BranchMoved: ({ name }) => `${name} changed since it was shown. Try again.`,
    BranchNotMerged: ({ count, name }) =>
      `${count} commits exist only on ${name}.`,
  });
}
