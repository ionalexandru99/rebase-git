import {
  defaultRangeExtractor,
  useVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual";
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  graphHeaderHeight,
  graphRowHeight as rowHeight,
} from "#web/features/commit-graph/layout/graph-metrics";

const overscanRows = 6;
const emptyViewport = { width: 0, height: 0 };

export interface CommitGraphViewportHandle {
  readonly getScrollOffset: () => number;
  readonly scrollToIndex: (index: number) => void;
}

export function CommitGraphVirtualWindow({
  ref,
  scrollRef,
  total,
  start,
  oids,
  activeIndex,
  onRange,
  onPageSize,
  children,
}: {
  readonly ref: Ref<CommitGraphViewportHandle>;
  readonly scrollRef: RefObject<HTMLTableElement | null>;
  readonly total: number;
  readonly start: number;
  readonly oids: readonly string[];
  readonly activeIndex: number | undefined;
  readonly onRange: (first: number, last: number) => void;
  readonly onPageSize: (size: number) => void;
  readonly children: (viewport: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly totalHeight: number;
    readonly virtualRows: readonly VirtualItem[];
  }) => ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count: total,
    estimateSize: () => rowHeight,
    paddingStart: graphHeaderHeight,
    scrollPaddingStart: graphHeaderHeight,
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
        if (previous !== null && previous.width !== width)
          instance.options.onChange?.(instance, false);
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    overscan: overscanRows,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (
        activeIndex !== undefined &&
        activeIndex < total &&
        !indexes.includes(activeIndex)
      )
        indexes.push(activeIndex);
      return indexes.sort((left, right) => left - right);
    },
  });
  const viewport = virtualizer.scrollRect ?? emptyViewport;
  const absoluteRows = virtualizer.getVirtualItems();
  const [rowSlots, setRowSlots] = useState<readonly (string | undefined)[]>([]);
  const rowKey = (index: number) => oids[index - start] ?? `row-${index}`;
  const rowKeys = absoluteRows.map((row) => rowKey(row.index));
  const nextSlots = reconcileRowSlots(rowSlots, rowKeys);
  const virtualRows = useMemo(
    () =>
      absoluteRows.map((row) => ({
        ...row,
        start: row.start - graphHeaderHeight,
        end: row.end - graphHeaderHeight,
        key: nextSlots.indexOf(oids[row.index - start] ?? `row-${row.index}`),
        index: row.index - start,
      })),
    [absoluteRows, oids, nextSlots, start],
  );
  const first = Math.floor((virtualizer.scrollOffset ?? 0) / rowHeight);
  const last =
    first +
    Math.max(0, Math.ceil((viewport.height - graphHeaderHeight) / rowHeight));
  useEffect(() => onRange(first, last), [onRange, first, last]);
  useEffect(
    () =>
      onPageSize(
        Math.max(
          1,
          Math.floor((viewport.height - graphHeaderHeight) / rowHeight),
        ),
      ),
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
    totalHeight: Math.max(0, virtualizer.getTotalSize() - graphHeaderHeight),
    virtualRows,
  });
}

function reconcileRowSlots(
  previous: readonly (string | undefined)[],
  keys: readonly string[],
) {
  const current = new Set(keys);
  if (
    keys.every((key) => previous.includes(key)) &&
    previous.every((key) => key === undefined || current.has(key))
  )
    return previous;
  const slots = previous.map((key) =>
    key !== undefined && current.has(key) ? key : undefined,
  );
  for (const key of keys) {
    if (slots.includes(key)) continue;
    const available = slots.indexOf(undefined);
    if (available < 0) slots.push(key);
    else slots[available] = key;
  }
  return slots;
}
