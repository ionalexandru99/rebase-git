import { skipToken } from "@tanstack/react-query";
import { useState } from "react";
import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  ChangedFile,
  RepositoryChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type ConflictFailure,
  type ConflictFile,
  type ConflictList,
  type ConflictPath,
  type ConflictScope,
  RepositoryConflictsApi,
  type WholeFileChoice,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  describeFailure,
  type RequestFailure,
  rejection,
} from "#web/platform/query/request-failure.ts";
import {
  answer,
  type CommandResult,
  useCommand,
} from "#web/platform/query/use-command.ts";

type ConflictRequestFailure = RequestFailure<
  ConflictFailure | RepositoryRejected
>;

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
    RepositoryConflictsApi.list,
    scope === null ? skipToken : conflictScope(scope),
    { ...fresh, enabled },
  );
}

export function useConflictDocument(
  input: ConflictPath | null,
  enabled = true,
) {
  return useEnvironmentQuery(
    RepositoryConflictsApi.document,
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

export function conflictReason(
  failure: ConflictRequestFailure | null | undefined,
): ConflictFailure["reason"] | null {
  const rejected = rejection(failure);
  return rejected?._tag === "ConflictFailed" ? rejected.reason : null;
}

export function wholeFileOnly(failure: ConflictRequestFailure | null) {
  const reason = conflictReason(failure);
  return reason === "Unsupported" || reason === "TooLarge";
}

export function useConflictActions(
  scope: ConflictScope,
  { revision, onResolved }: ConflictActionOptions,
) {
  const options = {
    target: scope,
    answers: (list: ConflictList, input: ConflictScope) => [
      answer(RepositoryConflictsApi.list, conflictScope(input), list),
    ],
  };
  const stage = useCommand(RepositoryConflictsApi.stage, options);
  const choose = useCommand(RepositoryConflictsApi.choose, options);
  const [markers, setMarkers] = useState<string | null>(null);
  const errorToast = useErrorToast();
  const settled = (
    result: CommandResult<
      typeof RepositoryConflictsApi.stage | typeof RepositoryConflictsApi.choose
    >,
  ) => {
    if (result._tag === "Ok") onResolved?.(result.value);
    else errorToast.failure("resolveConflict", result);
  };
  const input = (path: string) => {
    const current = revision(path);
    return current === undefined ? undefined : { path, revision: current };
  };
  const cancel = () => setMarkers(null);
  return {
    busy: stage.running || choose.running,
    confirming: markers,
    resolve: async (path: string, allowMarkers: boolean) => {
      const request = input(path);
      if (request === undefined) return;
      cancel();
      const result = await stage.run({ ...request, allowMarkers });
      const markersRemain =
        result._tag !== "Ok" && conflictReason(result) === "Markers";
      if (!allowMarkers && markersRemain) setMarkers(path);
      else settled(result);
    },
    choose: async (path: string, choice: WholeFileChoice) => {
      const request = input(path);
      if (request === undefined) return;
      cancel();
      settled(await choose.run({ ...request, choice }));
    },
    cancel,
  };
}

export function useConflicts(
  scope: ConflictScope,
  conflicted: readonly string[],
  selected: string | null,
  active: boolean,
) {
  const list = useConflictList(conflicted.length > 0 ? scope : null, active);
  const rows = conflictRows(conflicted, list.data);
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
      document.error === null ||
      conflictReason(document.error) === "Unsupported"
        ? null
        : describeFailure(document.error),
    problem: list.error === null ? null : describeFailure(list.error),
    refresh: () => {
      if (list.isError) void list.refetch();
      if (document.isError) void document.refetch();
    },
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
