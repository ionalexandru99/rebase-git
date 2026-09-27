import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import { useLayoutEffect, useMemo, useRef } from "react";
import { graphColors } from "#web/features/commit-graph/layout/graph-colors";
import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history";

export function useGraphColors(
  reader: RepositoryHistory | undefined,
  rows: readonly CommitLaneRow[],
  refs: readonly RepositoryHistoryRefTarget[],
) {
  const previous = useRef<
    | {
        reader: RepositoryHistory | undefined;
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
