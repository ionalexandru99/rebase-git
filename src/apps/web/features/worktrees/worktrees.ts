import { skipToken } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { RouteFailure } from "#contracts/environment-connection/environment-route.contract.ts";
import type {
  RepositoryRefs,
  RepositoryWorktree,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type RepositoryWorktreeStatus,
  RepositoryWorktreesApi,
  type WorktreeRejected,
  type WorktreeStart,
} from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import { refFailureMessages } from "#web/features/refs/ref-kinds.ts";
import { useScopedRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import { worktreeName } from "#web/features/worktrees/worktree-draft.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  describeFailure,
  type FailureMessages,
  rejection,
} from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export interface WorktreeRow {
  readonly worktree: RepositoryWorktree;
  readonly name: string;
  readonly detail: string;
  readonly changes: number | undefined;
  readonly active: boolean;
}

type WorktreeFailure =
  | RouteFailure<typeof RepositoryWorktreesApi.create>
  | RouteFailure<typeof RepositoryWorktreesApi.remove>
  | RouteFailure<typeof RepositoryWorktreesApi.setFolder>;

export function worktreeRows(
  refs: RepositoryRefs,
  activePath: string,
  status: RepositoryWorktreeStatus | undefined,
): readonly WorktreeRow[] {
  return refs.worktrees.map((worktree) => ({
    worktree,
    name: worktreeName(worktree.path),
    detail:
      worktree.missing === true
        ? "Folder missing"
        : (worktree.head.branch ??
          `Detached at ${worktree.head.commit.slice(0, 7)}`),
    changes: status?.worktrees.find(({ path }) => path === worktree.path)
      ?.changes,
    active: worktree.path === activePath,
  }));
}

function useWorktreeQueries(enabled: boolean) {
  const scope = useRepositoryScope();
  const input =
    scope === undefined
      ? skipToken
      : { repositoryId: scope.repositoryId, worktreePath: scope.worktreePath };
  const status = useEnvironmentQuery(RepositoryWorktreesApi.status, input, {
    changes: "index",
    enabled,
    staleTime: 0,
    refetchOnMount: true,
  });
  const folder = useEnvironmentQuery(RepositoryWorktreesApi.folder, input, {
    changes: "refs",
    enabled,
  });
  return { status: status.data, folder: folder.data };
}

export type Worktrees = ReturnType<typeof useWorktrees>;

export function useWorktrees(open: boolean) {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const { status, folder } = useWorktreeQueries(open);
  const activePath = scope?.worktreePath ?? "";
  const rows = useMemo(
    () => (refs === undefined ? [] : worktreeRows(refs, activePath, status)),
    [refs, activePath, status],
  );
  const anchor = rows.find(
    ({ worktree }) => worktree.main && worktree.missing !== true,
  )?.worktree.path;
  const target =
    scope === undefined || anchor === undefined
      ? undefined
      : { repositoryId: scope.repositoryId, worktreePath: anchor };
  const create = useCommand(RepositoryWorktreesApi.create);
  const remove = useCommand(RepositoryWorktreesApi.remove, { target });
  const unlock = useCommand(RepositoryWorktreesApi.unlock, { target });
  const errorToast = useErrorToast();
  const statusToast = useStatusToast();
  const [confirming, setConfirming] = useState<WorktreeRow>();
  const removeNow = useCallback(
    async (row: WorktreeRow, changes: number) => {
      setConfirming(undefined);
      const missing = row.worktree.missing === true;
      if (!missing)
        statusToast.progress("removeWorktree", `Removing “${row.name}”`);
      const result = await remove.run({ target: row.worktree.path, changes });
      if (result._tag === "Ok") {
        if (row.active && anchor !== undefined) scope?.switchWorktree(anchor);
        if (!missing)
          statusToast.success("removeWorktree", `Removed “${row.name}”`);
        return;
      }
      const changed = rejection(result);
      if (changed?._tag === "WorktreeChanged") {
        statusToast.close("removeWorktree");
        setConfirming({ ...row, changes: changed.changes });
        return;
      }
      errorToast.failure("removeWorktree", result, worktreeFailureMessages);
    },
    [anchor, scope, remove.run, statusToast, errorToast],
  );
  return {
    refs,
    rows,
    folder,
    activePath,
    writable: (scope?.writable ?? false) && create.canRun,
    creating: create.running,
    create: async (path: string, start: WorktreeStart) => {
      const result = await create.run({ path, start });
      if (result._tag === "Ok") {
        scope?.switchWorktree(result.value.worktreePath);
        return undefined;
      }
      if (result._tag === "Cancelled") return undefined;
      return describeFailure(result, {
        ...refFailureMessages(start.name),
        ...worktreeFailureMessages,
      });
    },
    remove: (row: WorktreeRow) => {
      if ((row.changes ?? 0) > 0) setConfirming(row);
      else void removeNow(row, 0);
    },
    unlock: async (row: WorktreeRow) =>
      errorToast.failure(
        "unlockWorktree",
        await unlock.run({ target: row.worktree.path }),
      ),
    switchTo: (row: WorktreeRow) => scope?.switchWorktree(row.worktree.path),
    confirmation: {
      row: confirming,
      busy: remove.running,
      confirm: () => {
        if (confirming !== undefined)
          void removeNow(confirming, confirming.changes ?? 0);
      },
      cancel: () => setConfirming(undefined),
    },
  };
}

export const worktreeFailureMessages: FailureMessages<WorktreeFailure> = {
  WorktreeRejected: ({ reason }) => rejectionMessage(reason),
  WorktreeChanged: () => "The worktree has new uncommitted changes.",
};

function rejectionMessage(reason: WorktreeRejected["reason"]) {
  switch (reason) {
    case "FolderExists":
      return "That folder already exists.";
    case "NotAbsolute":
      return "Enter a full folder path.";
    case "Locked":
      return "The worktree is locked.";
    case "Main":
      return "The main worktree can't be removed.";
    case "Current":
      return "Switch to another worktree first.";
    case "Unsaved":
      return "Its commits aren't on any branch. Create a branch first.";
  }
}

export function worktreeActions(
  row: WorktreeRow,
  writable: boolean,
  handlers: {
    readonly switchTo: () => void;
    readonly copyPath: () => void;
    readonly unlock: () => void;
    readonly remove: () => void;
  },
): readonly Action[] {
  const { worktree } = row;
  const missing = worktree.missing === true;
  const locked = worktree.locked;
  const readOnly = writable ? undefined : "Read only";
  const lockReason =
    locked === undefined
      ? undefined
      : locked.length === 0
        ? "Locked"
        : `Locked: ${locked}`;
  return [
    ...(row.active || missing
      ? []
      : [
          {
            id: "switch",
            label: "Switch to it",
            enabled: true,
            run: handlers.switchTo,
          },
        ]),
    {
      id: "copyPath",
      label: "Copy path",
      enabled: true,
      run: handlers.copyPath,
    },
    ...(locked === undefined
      ? []
      : [
          {
            id: "unlock",
            label: "Unlock",
            group: "edit" as const,
            ...enabledUnless(readOnly),
            run: handlers.unlock,
          },
        ]),
    ...(worktree.main
      ? []
      : [
          {
            id: "remove",
            label: missing ? "Prune" : "Remove…",
            group: "delete" as const,
            keys: ["Delete"],
            ...enabledUnless(readOnly ?? lockReason),
            run: handlers.remove,
          },
        ]),
  ];
}

function enabledUnless(reason: string | undefined) {
  return reason === undefined ? { enabled: true } : { enabled: false, reason };
}
