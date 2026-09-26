import type {
  ConflictFile,
  ConflictList,
  ConflictScope,
} from "@rebase/contracts";
import { useMemo } from "react";
import {
  describeChangesFailure,
  wholeFileOnly,
} from "#web/features/working-changes/changes-messages";
import { useConflictActions } from "#web/features/working-changes/conflicts/hooks/use-conflict-actions";
import {
  useConflictDocument,
  useConflictList,
} from "#web/features/working-changes/conflicts/hooks/use-conflict-queries";

export interface ConflictRow {
  readonly path: string;
  readonly file: ConflictFile | undefined;
}

export function useConflicts(
  scope: ConflictScope,
  conflicted: readonly string[],
  selected: string | null,
  active: boolean,
) {
  const list = useConflictList(scope, conflicted.length > 0, active);
  const rows = useMemo(
    () => conflictRows(conflicted, list.data),
    [conflicted, list.data],
  );
  const document = useConflictDocument(
    scope,
    selected !== null && conflicted.includes(selected) ? selected : null,
    active,
  );
  const actions = useConflictActions(
    scope,
    (path) => rows.find((row) => row.path === path)?.file,
  );
  return {
    ...actions,
    pending:
      actions.pending !== null && conflicted.includes(actions.pending)
        ? actions.pending
        : null,
    rows,
    list: list.data,
    document: document.data,
    documentProblem:
      document.isError && !wholeFileOnly(document.error)
        ? describeChangesFailure(document.error)
        : null,
    wholeFileOnly: document.isError && wholeFileOnly(document.error),
    problem:
      actions.problem ??
      (list.isError ? describeChangesFailure(list.error) : null),
    refresh: () => {
      actions.clearProblem();
      if (list.isError) void list.refetch();
      if (document.isError) void document.refetch();
    },
  };
}

export type Conflicts = ReturnType<typeof useConflicts>;

function conflictRows(
  conflicted: readonly string[],
  list: ConflictList | undefined,
): readonly ConflictRow[] {
  const files = new Map(list?.files.map((file) => [file.path, file]));
  return conflicted.map((path) => ({ path, file: files.get(path) }));
}
