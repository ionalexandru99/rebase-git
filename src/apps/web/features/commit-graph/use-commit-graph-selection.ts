import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CommitLaneRow } from "#web/features/commit-graph/commit-lanes";
import {
  clearGraphSelection,
  reconcileGraphSelection,
  selectGraphCommit,
} from "#web/features/commit-graph/commit-selection";
import {
  type CommitGraphSelectionMode,
  emptyCommitGraphSelection,
} from "#web/features/commit-graph/commit-selection.contract";
import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";

export function useCommitGraphSelection({
  reader,
  oids,
  laneRows,
  pageSize,
  scrollToIndex,
  toggleMerge,
  merges,
}: {
  readonly reader: RepositoryHistoryReader | undefined;
  readonly oids: readonly string[];
  readonly laneRows: readonly CommitLaneRow[];
  readonly pageSize: number;
  readonly scrollToIndex: (index: number) => void;
  readonly toggleMerge: (oid: string, expand: boolean) => void;
  readonly merges: ReadonlyMap<string, "collapsed" | "expanded">;
}) {
  const [selection, setSelection] = useState(emptyCommitGraphSelection);
  useEffect(() => {
    if (reader !== undefined) setSelection(emptyCommitGraphSelection);
  }, [reader]);
  useEffect(
    () => setSelection((current) => reconcileGraphSelection(current, oids)),
    [oids],
  );
  const selected = useMemo(
    () => new Set(selection.selectedOids),
    [selection.selectedOids],
  );
  const select = (oid: string, mode: CommitGraphSelectionMode = "replace") => {
    setSelection((current) => selectGraphCommit(current, oids, oid, mode));
  };
  const move = (index: number, mode: CommitGraphSelectionMode = "replace") => {
    const bounded = Math.max(0, Math.min(oids.length - 1, index));
    const oid = oids[bounded];
    if (oid === undefined) return;
    select(oid, mode);
    scrollToIndex(bounded);
  };
  const moveInLane = (direction: -1 | 1) => {
    const activeIndex = selection.activeIndex;
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
                ? 0
                : event.key === "End"
                  ? oids.length - 1
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
      setSelection(clearGraphSelection);
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelection((current) => ({ ...current, selectedOids: oids }));
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
    reset: () => setSelection(emptyCommitGraphSelection),
  };
}
