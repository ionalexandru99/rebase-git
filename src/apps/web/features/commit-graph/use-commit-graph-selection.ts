import type { KeyboardEvent, MouseEvent } from "react";
import type { CommitLaneRow } from "#web/features/commit-graph/commit-lanes";
import type { CommitGraphSelectionMode } from "#web/features/commit-graph/commit-selection.contract";
import { usePagedGraphSelection } from "#web/features/commit-graph/paging/use-paged-graph-selection";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

export function useCommitGraphSelection({
  reader,
  query,
  loading = false,
  oids,
  laneRows,
  pageSize,
  scrollToIndex,
  toggleMerge,
  merges,
  startOffset = 0,
  oldestLoadedOffset,
  viewEpoch = 0,
  requestMove,
  requestLaneMove,
}: {
  readonly reader:
    | Pick<RepositoryHistoryReader, "read" | "locateMany">
    | undefined;
  readonly query?: RepositoryHistoryQuery | undefined;
  readonly loading?: boolean;
  readonly oids: readonly string[];
  readonly laneRows: readonly CommitLaneRow[];
  readonly pageSize: number;
  readonly scrollToIndex: (index: number) => void;
  readonly toggleMerge: (oid: string, expand: boolean) => void;
  readonly merges: ReadonlyMap<string, "collapsed" | "expanded">;
  readonly startOffset?: number;
  readonly oldestLoadedOffset?: number;
  readonly viewEpoch?: number;
  readonly requestLaneMove?: (offset: number, direction: -1 | 1) => void;
  readonly requestMove?: (
    offset: number,
    mode: CommitGraphSelectionMode,
  ) => void;
}) {
  const model = usePagedGraphSelection({
    reader,
    query,
    oids,
    loading,
    startOffset,
    viewEpoch,
  });
  const { selection, selected, select } = model;
  const move = (index: number, mode: CommitGraphSelectionMode = "replace") => {
    if (requestMove !== undefined) {
      requestMove(Math.max(0, index + startOffset), mode);
      return;
    }
    const bounded = Math.max(0, Math.min(oids.length - 1, index));
    const oid = oids[bounded];
    if (oid === undefined) return;
    select(oid, mode);
    scrollToIndex(bounded);
  };
  const moveInLane = (direction: -1 | 1) => {
    const activeIndex = selection.activeIndex;
    if (requestLaneMove !== undefined) {
      requestLaneMove(activeIndex + startOffset, direction);
      return;
    }
    const lane = laneRows[activeIndex]?.nodeLaneId;
    if (lane === undefined) return;
    for (
      let index = activeIndex + direction;
      index >= 0 && index < laneRows.length;
      index += direction
    ) {
      if (laneRows[index]?.nodeLaneId === lane) {
        move(index);
        return;
      }
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const oid = selection.activeOid;
    if (
      (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
      oid !== undefined &&
      merges.has(oid)
    ) {
      event.preventDefault();
      toggleMerge(oid, event.key === "ArrowRight");
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const mode = event.shiftKey ? "range" : mod ? "activate" : "replace";
    const destination =
      event.key === "ArrowDown"
        ? selection.activeIndex + 1
        : event.key === "ArrowUp"
          ? selection.activeIndex - 1
          : event.key === "PageDown"
            ? selection.activeIndex + pageSize
            : event.key === "PageUp"
              ? selection.activeIndex - pageSize
              : event.key === "Home"
                ? -startOffset
                : event.key === "End"
                  ? (oldestLoadedOffset ?? oids.length - 1) - startOffset
                  : undefined;
    if (destination !== undefined) {
      event.preventDefault();
      move(destination, mode);
    } else if (
      (event.key === " " || event.key === "Enter") &&
      oid !== undefined
    ) {
      event.preventDefault();
      select(
        oid,
        event.key === " " ? (event.shiftKey ? "range" : "toggle") : "replace",
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      model.clear();
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      model.selectAll();
    }
  };
  const onClick = (oid: string, event: MouseEvent) => {
    select(
      oid,
      event.shiftKey
        ? "range"
        : event.metaKey || event.ctrlKey
          ? "toggle"
          : "replace",
    );
  };
  return {
    selection,
    selected,
    select,
    moveInLane,
    onKeyDown,
    onClick,
    reset: model.reset,
  };
}
