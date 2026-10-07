import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { rowElementId } from "#web/features/branches-sidebar/branches-sidebar-rows.tsx";
import {
  type BranchesSidebarItem,
  estimateItemHeight,
  firstDockedIndex,
  isSectionItem,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";

type RenderItem = (item: BranchesSidebarItem) => ReactNode;

interface PlacedRow {
  readonly index: number;
  readonly item: BranchesSidebarItem;
  readonly size: number;
  readonly start: number;
}

interface MountedRow {
  readonly node: HTMLElement;
  readonly start: number;
}

interface RegionLayout {
  readonly items: readonly BranchesSidebarItem[];
  readonly rows: ReadonlyMap<string, MountedRow>;
}

interface Viewport {
  readonly height: number;
  readonly top: number;
}

const overscanRows = 12;
const listPadding = 8;
const headerHeight = 32;
const motionTiming = { duration: 150, easing: "ease-out" };
const maxFadedRows = 40;

export function DockedTree({
  activeRowId,
  busy,
  children,
  items,
  onKeyDown,
  renderItem,
  treeRef,
}: {
  readonly activeRowId: string | undefined;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly items: readonly BranchesSidebarItem[];
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly renderItem: RenderItem;
  readonly treeRef: Ref<HTMLDivElement>;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const viewportHeight = useHeight(scrollRef);
  const headers = useMemo(() => sectionIndexes(items), [items]);
  const dockIndex = useMemo(() => firstDockedIndex(items), [items]);
  const activeIndex = items.findIndex((item) => item.id === activeRowId);
  const rangeExtractor = useCallback(
    (range: Range) =>
      [...new Set([...headers, ...defaultRangeExtractor(range)])].sort(
        (left, right) => left - right,
      ),
    [headers],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => estimateItemHeight(items[index]),
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: overscanRows,
    paddingEnd: listPadding,
    rangeExtractor,
    scrollPaddingEnd: headersAfter(headers, activeIndex) * headerHeight,
    scrollPaddingStart: headerHeight,
  });
  const total = virtualizer.getTotalSize();
  const gap = dockIndex > 0 ? Math.max(0, viewportHeight - total) : 0;
  const placed = virtualizer
    .getVirtualItems()
    .flatMap(({ index, size, start }): PlacedRow[] => {
      const item = items[index];
      return item === undefined
        ? []
        : [
            {
              index,
              item,
              size,
              start: dockIndex > 0 && index >= dockIndex ? start + gap : start,
            },
          ];
    });
  const viewport = {
    height: viewportHeight,
    top: virtualizer.scrollOffset ?? 0,
  };
  useRowMotion(listRef, items, placed, viewport);

  const draftIndex = items.findIndex(
    (item) => item.kind === "draft" || item.kind === "stash-draft",
  );
  useEffect(() => {
    if (draftIndex >= 0) virtualizer.scrollToIndex(draftIndex);
  }, [draftIndex, virtualizer]);

  const expansions = useRef<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    const previous = expansions.current;
    expansions.current = new Map(
      items.filter(isSectionItem).map((item) => [item.id, item.row.expanded]),
    );
    const toggled = items.findIndex(
      (item) =>
        isSectionItem(item) &&
        previous.has(item.id) &&
        previous.get(item.id) !== item.row.expanded,
    );
    const header = virtualizer
      .getVirtualItems()
      .find(({ index }) => index === toggled);
    const top = virtualizer.scrollOffset ?? 0;
    const height = virtualizer.scrollRect?.height ?? 0;
    if (
      header !== undefined &&
      (header.start < top || header.end > top + height)
    ) {
      virtualizer.scrollToOffset(header.start);
      return;
    }
    if (activeIndex >= 0)
      virtualizer.scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, items, virtualizer]);

  let cursor = 0;
  return (
    <div
      aria-activedescendant={
        activeRowId === undefined ? undefined : rowElementId(activeRowId)
      }
      aria-busy={busy}
      aria-label="Branches"
      aria-multiselectable="true"
      className={`group/tree flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${busy ? "cursor-progress opacity-60" : ""}`}
      onKeyDown={onKeyDown}
      ref={treeRef}
      role="tree"
      tabIndex={0}
    >
      {children}
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={scrollRef}
        tabIndex={-1}
      >
        <div
          className="relative w-full"
          ref={listRef}
          style={{ height: total + gap }}
        >
          {placed.flatMap((row) => {
            const space = row.start - cursor;
            cursor = row.start + row.size;
            const pinned = isSectionItem(row.item);
            return [
              space > 0 ? (
                <div
                  aria-hidden="true"
                  key={`space:${row.item.id}`}
                  style={{ height: space }}
                />
              ) : null,
              <div
                className={`bg-sidebar ${pinned ? "sticky z-10" : ""}`}
                data-index={row.index}
                key={row.item.id}
                ref={virtualizer.measureElement}
                style={
                  pinned
                    ? {
                        bottom: headersAfter(headers, row.index) * headerHeight,
                        top: 0,
                      }
                    : undefined
                }
              >
                {renderItem(row.item)}
              </div>,
            ];
          })}
        </div>
      </div>
    </div>
  );
}

function sectionIndexes(items: readonly BranchesSidebarItem[]): number[] {
  return items.flatMap((item, index) => (isSectionItem(item) ? [index] : []));
}

function headersAfter(headers: readonly number[], index: number): number {
  return index < 0 ? 0 : headers.filter((header) => header > index).length;
}

function useHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

function useRowMotion(
  listRef: RefObject<HTMLDivElement | null>,
  items: readonly BranchesSidebarItem[],
  placed: readonly PlacedRow[],
  viewport: Viewport,
) {
  const previous = useRef<RegionLayout>(undefined);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const before = previous.current;
    const after = { items, rows: mountedRows(list, placed, viewport) };
    previous.current = after;
    if (
      before !== undefined &&
      before.items !== items &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      animateRows(list, before, after);
  });
}

function mountedRows(
  list: HTMLElement,
  placed: readonly PlacedRow[],
  viewport: Viewport,
): Map<string, MountedRow> {
  const nodes = new Map(
    Array.from(list.children).flatMap((node) =>
      node instanceof HTMLElement && node.dataset.index !== undefined
        ? [[Number(node.dataset.index), node]]
        : [],
    ),
  );
  return new Map(
    placed.flatMap(({ index, item, size, start }) => {
      const node = nodes.get(index);
      const pinned =
        isSectionItem(item) &&
        (start < viewport.top || start + size > viewport.top + viewport.height);
      return node === undefined || pinned ? [] : [[item.id, { node, start }]];
    }),
  );
}

function animateRows(
  list: HTMLElement,
  before: RegionLayout,
  after: RegionLayout,
) {
  const removed = [...before.rows].filter(([id]) => !after.rows.has(id));
  const remaining = removed.length === 0 ? undefined : itemIds(after.items);
  const exiting = removed.filter(([id]) => !remaining?.has(id));
  const added = [...after.rows].filter(([id]) => !before.rows.has(id));
  const known = added.length === 0 ? undefined : itemIds(before.items);
  const entering = added.filter(([id]) => !known?.has(id));
  if (exiting.length + entering.length > maxFadedRows) return;
  for (const [, row] of exiting) fadeOut(list, row);
  let riding = 0;
  for (const [id, { node, start }] of after.rows) {
    const previous = before.rows.get(id);
    if (previous === undefined && !known?.has(id)) {
      node.animate([{ opacity: 0 }, { opacity: 1 }], motionTiming);
      continue;
    }
    const offset =
      previous === undefined
        ? riding
        : previous.start - start + remainingTravel(node);
    riding = offset;
    if (offset !== 0)
      node.animate(
        [{ translate: `0 ${offset}px` }, { translate: "0 0" }],
        motionTiming,
      );
  }
}

function itemIds(items: readonly BranchesSidebarItem[]): Set<string> {
  return new Set(items.map(({ id }) => id));
}

function fadeOut(list: HTMLElement, { node, start }: MountedRow) {
  const copy = node.cloneNode(true) as HTMLElement;
  for (const element of [
    copy,
    ...copy.querySelectorAll("[id], [data-index]"),
  ]) {
    element.removeAttribute("id");
    element.removeAttribute("data-index");
  }
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.style.pointerEvents = "none";
  copy.style.position = "absolute";
  copy.style.top = `${start}px`;
  copy.style.width = "100%";
  list.prepend(copy);
  copy
    .animate([{ opacity: 1 }, { opacity: 0 }], motionTiming)
    .addEventListener("finish", () => copy.remove(), { once: true });
}

function remainingTravel(node: HTMLElement): number {
  if (node.getAnimations().length === 0) return 0;
  const [, y = "0"] = getComputedStyle(node).translate.split(" ");
  return Number.parseFloat(y);
}
