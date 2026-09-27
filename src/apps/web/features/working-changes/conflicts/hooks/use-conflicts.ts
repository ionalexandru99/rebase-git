import {
  type ChangedFile,
  type ConflictFile,
  type ConflictList,
  type ConflictPath,
  type ConflictScope,
  type RepositoryChanges,
  RepositoryConflictsHttpApi,
  type WholeFileChoice,
} from "@rebase/contracts";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  conflictReason,
  describeChangesFailure,
  wholeFileOnly,
} from "#web/features/working-changes/changes-messages";
import { changesWriteScope } from "#web/features/working-changes/hooks/use-change-actions";
import { useEnvironment } from "#web/platform/query/environment-context";
import {
  environmentQueryKey,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";
import { useCommand } from "#web/platform/query/use-command";

export interface ConflictRow {
  readonly path: string;
  readonly file: ConflictFile | undefined;
}

interface ConflictActionOptions {
  readonly revision: (path: string) => string | undefined;
  readonly onResolved?: (list: ConflictList) => void;
}

const fresh = {
  changes: "index",
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const;

export function useConflictList(scope: ConflictScope | null, enabled = true) {
  return useEnvironmentQuery(
    RepositoryConflictsHttpApi.list,
    scope === null ? skipToken : conflictScope(scope),
    { ...fresh, enabled },
  );
}

export function useConflictDocument(
  input: ConflictPath | null,
  enabled = true,
) {
  return useEnvironmentQuery(
    RepositoryConflictsHttpApi.document,
    input === null ? skipToken : { ...conflictScope(input), path: input.path },
    { ...fresh, enabled },
  );
}

export function splitConflicts(changes: RepositoryChanges | undefined) {
  if (changes === undefined) return { changes, conflicted: [] };
  const conflicted = [
    ...new Set(
      [...changes.unstaged, ...changes.staged]
        .filter(isConflicted)
        .map((file) => file.path),
    ),
  ];
  if (conflicted.length === 0) return { changes, conflicted };
  return {
    changes: {
      ...changes,
      unstaged: changes.unstaged.filter((file) => !isConflicted(file)),
      staged: changes.staged.filter((file) => !isConflicted(file)),
    },
    conflicted,
  };
}

export function useConflictActions(
  scope: ConflictScope,
  { revision, onResolved }: ConflictActionOptions,
) {
  const store = useStoreConflictList(scope);
  const options = {
    repository: scope,
    scope: changesWriteScope(scope),
    onSuccess: store,
  };
  const stage = useCommand(RepositoryConflictsHttpApi.stage, options);
  const choose = useCommand(RepositoryConflictsHttpApi.choose, options);
  const resolved = { onSuccess: (list: ConflictList) => onResolved?.(list) };
  const markersFound =
    conflictReason(stage.error) === "Markers" &&
    stage.variables?.allowMarkers === false;
  const failure = (markersFound ? null : stage.error) ?? choose.error;
  const command = (path: string) => {
    const current = revision(path);
    return current === undefined
      ? undefined
      : { ...conflictScope(scope), path, revision: current };
  };
  return {
    busy: stage.isPending || choose.isPending,
    confirming: markersFound ? (stage.variables?.path ?? null) : null,
    problem: failure === null ? null : describeChangesFailure(failure),
    resolve: (path: string, allowMarkers: boolean) => {
      const input = command(path);
      if (input === undefined) return;
      choose.reset();
      stage.mutate({ ...input, allowMarkers }, resolved);
    },
    choose: (path: string, choice: WholeFileChoice) => {
      const input = command(path);
      if (input === undefined) return;
      stage.reset();
      choose.mutate({ ...input, choice }, resolved);
    },
    cancel: () => stage.reset(),
    reset: () => {
      stage.reset();
      choose.reset();
    },
  };
}

export function useConflicts(
  scope: ConflictScope,
  conflicted: readonly string[],
  selected: string | null,
  active: boolean,
) {
  const list = useConflictList(conflicted.length > 0 ? scope : null, active);
  const rows = useMemo(
    () => conflictRows(conflicted, list.data),
    [conflicted, list.data],
  );
  const document = useConflictDocument(
    selected !== null && conflicted.includes(selected)
      ? { ...scope, path: selected }
      : null,
    active,
  );
  const actions = useConflictActions(scope, {
    revision: (path) => rows.find((row) => row.path === path)?.file?.revision,
  });
  const documentOnlyWhole = wholeFileOnly(document.error);
  return {
    ...actions,
    rows,
    sides: list.data?.sides,
    document: document.data,
    wholeFileOnly: documentOnlyWhole,
    documentProblem:
      document.error === null || documentOnlyWhole
        ? null
        : describeChangesFailure(document.error),
    problem:
      actions.problem ??
      (list.error === null ? null : describeChangesFailure(list.error)),
    refresh: () => {
      actions.reset();
      if (list.isError) void list.refetch();
      if (document.isError) void document.refetch();
    },
  };
}

function useStoreConflictList(scope: ConflictScope) {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  return async (list: ConflictList) => {
    const queryKey = environmentQueryKey(
      environmentId,
      scope.repositoryId,
      RepositoryConflictsHttpApi.list,
      conflictScope(scope),
    );
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, list);
  };
}

function conflictScope({
  repositoryId,
  worktreePath,
}: ConflictScope): ConflictScope {
  return { repositoryId, worktreePath };
}

function conflictRows(
  conflicted: readonly string[],
  list: ConflictList | undefined,
): readonly ConflictRow[] {
  const files = new Map(list?.files.map((file) => [file.path, file]));
  return conflicted.map((path) => ({ path, file: files.get(path) }));
}

function isConflicted(file: ChangedFile) {
  return file.status === "U";
}
