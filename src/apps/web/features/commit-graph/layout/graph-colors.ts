import { useLayoutEffect, useMemo, useRef } from "react";
import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import {
  type CommitLaneRow,
  graphBranchColorIndex,
  graphRefName,
  laneColorCount,
} from "#web/features/repository-history/commit-lanes.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

export const graphRemoteOpacity = 0.4;

export function graphLaneColor(color: number) {
  return `var(--lane-${color % laneColorCount})`;
}

export function graphNodeColorIndex(row: CommitLaneRow) {
  return row.lanesBefore.find((lane) => lane.id === row.nodeLaneId)?.color ?? 0;
}

export function graphNodeColor(row: CommitLaneRow) {
  return graphLaneColor(graphNodeColorIndex(row));
}

export function graphCanvasLaneColors() {
  const style = getComputedStyle(document.documentElement);
  return (color: number) =>
    style.getPropertyValue(`--lane-${color % laneColorCount}`).trim();
}

export function graphColors(
  rows: readonly CommitLaneRow[],
  refs: readonly RepositoryHistoryRefTarget[],
  previousRefs?: ReadonlyMap<string, string>,
) {
  const nodes = new Map(rows.map((row) => [row.oid, graphNodeColor(row)]));
  return {
    nodes,
    refs: new Map(
      refs
        .filter((ref) => ref.type === "branch" || ref.type === "remote-branch")
        .map((ref) => {
          return [
            ref.name,
            nodes.get(ref.oid) ??
              previousRefs?.get(ref.name) ??
              graphLaneColor(graphBranchColorIndex(graphRefName(ref))),
          ];
        }),
    ),
  };
}

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
