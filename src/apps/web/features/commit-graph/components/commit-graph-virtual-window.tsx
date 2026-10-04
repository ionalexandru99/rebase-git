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
} from "react";
import { graphRowHeight as rowHeight } from "#web/features/commit-graph/layout/graph-geometry.ts";

const overscanRows = 6;
const emptyViewport = { width: 0, height: 0 };

export interface GraphVirtualRow {
  readonly index: number;
  readonly key: string;
  readonly start: number | undefined;
}

export interface CommitGraphViewportHandle {
  readonly scrollToIndex: (index: number) => void;
}

export function CommitGraphVirtualWindow({
  ref,
  scrollRef,
  headerHeight,
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
  readonly headerHeight: number;
  readonly total: number;
  readonly start: number;
  readonly oids: readonly string[];
  readonly activeIndex: number | undefined;
  readonly onRange: (first: number, last: number) => void;
  readonly onPageSize: (size: number) => void;
  readonly children: (viewport: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly totalHeight: number;
    readonly flowStart: number;
    readonly virtualRows: readonly GraphVirtualRow[];
  }) => ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count: total,
    estimateSize: () => rowHeight,
    paddingStart: headerHeight,
    scrollPaddingStart: headerHeight,
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
  const items = virtualizer.getVirtualItems();
  const detached = detachedIndex(items, activeIndex);
  const flowStart =
    (items.find(
      (item) =>
        item.index !== detached && oids[item.index - start] !== undefined,
    )?.start ?? headerHeight) - headerHeight;
  const virtualRows = items.map((item) => ({
    index: item.index - start,
    key: oids[item.index - start] ?? `row-${item.index}`,
    start: item.index === detached ? item.start - headerHeight : undefined,
  }));
  const first = Math.floor((virtualizer.scrollOffset ?? 0) / rowHeight);
  const last =
    first +
    Math.max(0, Math.ceil((viewport.height - headerHeight) / rowHeight));
  useEffect(() => onRange(first, last), [onRange, first, last]);
  useEffect(
    () =>
      onPageSize(
        Math.max(1, Math.floor((viewport.height - headerHeight) / rowHeight)),
      ),
    [onPageSize, viewport.height, headerHeight],
  );
  useImperativeHandle(ref, () => ({
    scrollToIndex: (index) =>
      virtualizer.scrollToIndex(index, { align: "auto" }),
  }));
  return children({
    viewport,
    totalHeight: Math.max(0, virtualizer.getTotalSize() - headerHeight),
    flowStart,
    virtualRows,
  });
}

function detachedIndex(
  items: readonly VirtualItem[],
  activeIndex: number | undefined,
) {
  const others = items.filter((item) => item.index !== activeIndex);
  const first = others[0]?.index;
  const last = others.at(-1)?.index;
  return activeIndex !== undefined &&
    first !== undefined &&
    last !== undefined &&
    (activeIndex < first || activeIndex > last)
    ? activeIndex
    : undefined;
}
