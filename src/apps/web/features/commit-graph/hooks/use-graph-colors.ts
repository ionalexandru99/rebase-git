import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lane-model";
import { graphColors } from "#web/features/commit-graph/layout/graph-colors";
import type { RepositoryHistoryReadModel } from "#web/features/repository-history/repository-history-reader";

export function useGraphColors(
  reader: RepositoryHistoryReadModel | undefined,
  rows: readonly CommitLaneRow[],
  refs: readonly RepositoryHistoryRefTarget[],
) {
  const previous = useRef<
    | {
        reader: RepositoryHistoryReadModel | undefined;
        refs: ReadonlyMap<string, string>;
      }
    | undefined
  >(undefined);
  const colors = useMemo(
    () =>
      graphColors(
        rows,
        refs,
        previous.current?.reader === reader
          ? previous.current?.refs
          : undefined,
      ),
    [reader, rows, refs],
  );
  useLayoutEffect(() => {
    previous.current = { reader, refs: colors.refs };
  }, [reader, colors.refs]);
  return colors;
}
