import type { RepositoryCommit } from "@rebase/contracts";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual";
import {
  type ReactNode,
  type Ref,
  type RefObject,
  type UIEventHandler,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { CommitGraphViewportHandle } from "#web/features/commit-graph/commit-graph.contract";
import type {
  CommitGraphPageWindow,
  CommitGraphPageWindowSnapshot,
} from "#web/features/commit-graph/paging/commit-graph-page-window.contract";

const rowHeight = 36;
const overscanRows = 6;
const emptyViewport = { width: 0, height: 0 };

export function CommitGraphVirtualWindow({
  ref,
  scrollRef,
  commits,
  snapshot,
  engine,
  activeOid,
  onPageSize,
  children,
}: {
  readonly ref: Ref<CommitGraphViewportHandle>;
  readonly scrollRef: RefObject<HTMLTableElement | null>;
  readonly commits: readonly RepositoryCommit[];
  readonly snapshot: CommitGraphPageWindowSnapshot;
  readonly engine: CommitGraphPageWindow | undefined;
  readonly activeOid: string | undefined;
  readonly onPageSize: (size: number) => void;
  readonly children: (viewport: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly horizontalOffset: number;
    readonly verticalOffset: number;
    readonly totalHeight: number;
    readonly virtualRows: readonly VirtualItem[];
    readonly onScroll: UIEventHandler<HTMLTableElement>;
  }) => ReactNode;
}) {
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const error = snapshot.error;
  const virtualizer = useVirtualizer({
    count:
      snapshot.knownEndOffset +
      (commits.length > 0 && snapshot.hasOlder ? 1 : 0),
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (element === null) return;
      callback({ width: element.clientWidth, height: element.clientHeight });
      const observer = new ResizeObserver(([entry]) => {
        if (entry === undefined) return;
        const previous = instance.scrollRect;
        const { width, height } = entry.contentRect;
        callback({ width, height });
        if (
          previous !== null &&
          previous.width !== width &&
          previous.height === height
        )
          instance.options.onChange?.(instance, false);
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    overscan: overscanRows,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const active = commits.findIndex((commit) => commit.oid === activeOid);
      const index = active + snapshot.startOffset;
      if (active >= 0 && !indexes.includes(index)) indexes.push(index);
      if (
        error !== undefined &&
        error.offset >= snapshot.endOffset &&
        !indexes.includes(error.offset)
      )
        indexes.push(error.offset);
      return indexes.sort((left, right) => left - right);
    },
  });
  const viewport = virtualizer.scrollRect ?? emptyViewport;
  const absoluteRows = virtualizer.getVirtualItems();
  const [rowSlots, setRowSlots] = useState<readonly (string | undefined)[]>([]);
  const rowOids = absoluteRows.map(
    (row) =>
      commits[row.index - snapshot.startOffset]?.oid ?? `retry-${row.index}`,
  );
  const nextSlots = reconcileRowSlots(rowSlots, rowOids);
  const virtualRows = useMemo(
    () =>
      absoluteRows.map((row) => ({
        ...row,
        key: nextSlots.indexOf(
          commits[row.index - snapshot.startOffset]?.oid ??
            `retry-${row.index}`,
        ),
        index: row.index - snapshot.startOffset,
      })),
    [absoluteRows, commits, nextSlots, snapshot.startOffset],
  );
  const firstVirtual =
    commits.length === 0
      ? undefined
      : Math.floor((virtualizer.scrollOffset ?? 0) / rowHeight);
  const lastVirtual =
    firstVirtual === undefined
      ? undefined
      : firstVirtual + Math.ceil(viewport.height / rowHeight);
  useEffect(() => {
    if (
      firstVirtual === undefined ||
      lastVirtual === undefined ||
      engine === undefined ||
      snapshot.loading ||
      snapshot.error !== undefined
    )
      return;
    if (
      firstVirtual < snapshot.startOffset ||
      firstVirtual >= snapshot.endOffset
    )
      void engine.prefetchOffset(firstVirtual);
    else engine.setViewport(firstVirtual, lastVirtual);
  }, [
    firstVirtual,
    lastVirtual,
    engine,
    snapshot.startOffset,
    snapshot.endOffset,
    snapshot.loading,
    snapshot.error,
  ]);

  useEffect(
    () => onPageSize(Math.max(1, Math.floor(viewport.height / rowHeight))),
    [onPageSize, viewport.height],
  );
  useImperativeHandle(ref, () => ({
    getScrollOffset: () => virtualizer.scrollOffset ?? 0,
    scrollToIndex: (index) =>
      virtualizer.scrollToIndex(index, { align: "auto" }),
  }));
  if (nextSlots !== rowSlots) {
    setRowSlots(nextSlots);
    return null;
  }
  return children({
    viewport,
    horizontalOffset,
    verticalOffset: virtualizer.scrollOffset ?? 0,
    totalHeight: virtualizer.getTotalSize(),
    virtualRows,
    onScroll: (event) => setHorizontalOffset(event.currentTarget.scrollLeft),
  });
}

function reconcileRowSlots(
  previous: readonly (string | undefined)[],
  oids: readonly string[],
) {
  const current = new Set(oids);
  if (
    oids.every((oid) => previous.includes(oid)) &&
    previous.every((oid) => oid === undefined || current.has(oid))
  )
    return previous;
  const slots = previous.map((oid) =>
    oid !== undefined && current.has(oid) ? oid : undefined,
  );
  for (const oid of oids) {
    if (slots.includes(oid)) continue;
    const available = slots.indexOf(undefined);
    if (available < 0) slots.push(oid);
    else slots[available] = oid;
  }
  return slots;
}
