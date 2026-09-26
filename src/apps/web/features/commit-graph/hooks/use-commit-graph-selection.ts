import type { KeyboardEvent, MouseEvent } from "react";
import type { CommitGraphSelectionMode } from "#web/features/commit-graph/commit-selection.contract";
import { usePagedGraphSelection } from "#web/features/commit-graph/hooks/use-paged-graph-selection";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReadModel,
} from "#web/features/repository-history/repository-history-reader.contract";

export function useCommitGraphSelection({
  reader,
  query,
  loading = false,
  oids,
  pageSize,
  scrollToIndex,
  toggleMerge,
  merges,
  startOffset = 0,
  oldestLoadedOffset,
  viewEpoch = 0,
  requestMove,
  onSelectionIntent,
  onActiveCommitChange,
}: {
  readonly reader:
    | Pick<RepositoryHistoryReadModel, "read" | "locateMany">
    | undefined;
  readonly query?: RepositoryHistoryQuery | undefined;
  readonly loading?: boolean;
  readonly oids: readonly string[];
  readonly pageSize: number;
  readonly scrollToIndex: (index: number) => void;
  readonly toggleMerge: (oid: string, expand: boolean) => void;
  readonly merges: ReadonlyMap<string, "collapsed" | "expanded">;
  readonly startOffset?: number;
  readonly oldestLoadedOffset?: number;
  readonly viewEpoch?: number;
  readonly onSelectionIntent?: () => void;
  readonly onActiveCommitChange?:
    | ((oid: string | undefined) => void)
    | undefined;
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
    onActiveCommitChange,
  });
  const { selection, selected, select } = model;
  const move = (index: number, mode: CommitGraphSelectionMode = "replace") => {
    const target =
      requestMove === undefined
        ? Math.max(0, Math.min(oids.length - 1, index))
        : Math.max(-startOffset, index);
    const oid = oids[target];
    if (oid === undefined) {
      if (requestMove === undefined) return;
      model.cancelPending();
      requestMove(target + startOffset, mode);
      return;
    }
    onSelectionIntent?.();
    select(oid, mode);
    scrollToIndex(target);
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
      onSelectionIntent?.();
      select(
        oid,
        event.key === " " ? (event.shiftKey ? "range" : "toggle") : "replace",
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      onSelectionIntent?.();
      model.clear();
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectionIntent?.();
      model.selectAll();
    }
  };
  const onClick = (oid: string, event: MouseEvent) => {
    onSelectionIntent?.();
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
    onKeyDown,
    onClick,
    reset: model.reset,
  };
}
