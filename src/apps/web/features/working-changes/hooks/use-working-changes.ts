import { skipToken } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import {
  type ChangesScope,
  type ChangesWritten,
  type ReadChangeDiff,
  type RepositoryChanges,
  RepositoryChangesApi,
  type ViewedChange,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { splitConflicts } from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import type { SelectedChange } from "#web/features/working-changes/hooks/use-change-selection.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  answer,
  type CommandTarget,
  useCommand,
} from "#web/platform/query/use-command.ts";

function changesScope({
  repositoryId,
  worktreePath,
  amend,
}: ChangesScope): ChangesScope {
  return { repositoryId, worktreePath, amend };
}

function changeDiffInput(
  scope: ChangesScope,
  { section, path }: ViewedChange,
): ReadChangeDiff {
  return { ...changesScope(scope), section, path };
}

const refreshMilliseconds = 10_000;

export function useWorkingChanges(scope: ChangesScope, enabled: boolean) {
  return useEnvironmentQuery(RepositoryChangesApi.read, changesScope(scope), {
    enabled,
    changes: "index",
    staleTime: 0,
    refetchInterval: refreshMilliseconds,
    refetchOnWindowFocus: true,
    keepPrevious: true,
  });
}

export type Amend =
  | { readonly on: false }
  | { readonly on: true; readonly head?: string | null };

export const amendOff: Amend = { on: false };

export function useAmendHead(
  amend: Amend,
  setAmend: Dispatch<SetStateAction<Amend>>,
  settled: RepositoryChanges | undefined,
  headMoved: () => void,
) {
  useEffect(() => {
    if (!amend.on || settled === undefined) return;
    if (amend.head === undefined) {
      setAmend({ on: true, head: settled.head });
    } else if (settled.head !== amend.head) {
      setAmend(amendOff);
      headMoved();
    }
  }, [amend, settled, setAmend, headMoved]);
}

export function useChangeDiff(
  scope: ChangesScope,
  selection: SelectedChange | null,
  changes: RepositoryChanges | undefined,
  enabled: boolean,
) {
  const viewed =
    selection === null || selection.section === "conflicts" ? null : selection;
  const listed =
    viewed !== null &&
    changes?.[viewed.section].some((file) => file.path === viewed.path);
  return useEnvironmentQuery(
    RepositoryChangesApi.diff,
    listed ? changeDiffInput(scope, viewed) : skipToken,
    {
      enabled,
      changes: "none",
      gcTime: 0,
      ...(changes === undefined ? {} : { version: changes.revision }),
    },
  );
}

type WrittenScope = ChangesScope & { readonly viewed?: ViewedChange };

export function useChangeActions(target: CommandTarget) {
  const mutate = useCommand(RepositoryChangesApi.mutate, {
    target,
    answers: (written, input) => changesAnswers(input, written),
  });
  const commit = useCommand(RepositoryChangesApi.commit, {
    target,
    answers: (written, input) =>
      changesAnswers({ ...input, amend: false }, written),
  });
  const undoDiscard = useCommand(RepositoryChangesApi.undoDiscard, {
    target,
    answers: (written, input) => changesAnswers(input, written),
  });
  return {
    mutate,
    commit,
    undoDiscard,
    busy: mutate.running || commit.running || undoDiscard.running,
  };
}

function changesAnswers(scope: WrittenScope, written: ChangesWritten) {
  const changes = answer(
    RepositoryChangesApi.read,
    changesScope(scope),
    written.changes,
  );
  if (scope.viewed === undefined || written.diff === null) return [changes];
  return [
    changes,
    answer(
      RepositoryChangesApi.diff,
      changeDiffInput(scope, scope.viewed),
      written.diff,
      written.changes.revision,
    ),
  ];
}

export interface UncommittedChanges {
  readonly head: string | null;
  readonly unstaged: number;
  readonly staged: number;
}

export function useUncommittedChanges(): UncommittedChanges | undefined {
  const scope = useRepositoryScope();
  const read = useWorkingChanges(
    {
      repositoryId: scope?.repositoryId ?? "",
      worktreePath: scope?.worktreePath ?? "",
      amend: false,
    },
    scope !== undefined,
  );
  const { changes, conflicted } = splitConflicts(read.data);
  if (
    scope === undefined ||
    read.isPlaceholderData ||
    changes === undefined ||
    changes.unstaged.length + changes.staged.length + conflicted.length === 0
  )
    return undefined;
  return {
    head: changes.head,
    unstaged: changes.unstaged.length,
    staged: changes.staged.length,
  };
}
