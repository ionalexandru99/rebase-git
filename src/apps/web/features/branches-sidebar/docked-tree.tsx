import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import {
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { rowElementId } from "#web/features/branches-sidebar/branches-sidebar-rows.tsx";
import {
  type BranchesSidebarItem,
  dockItems,
  estimateItemHeight,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";

type RenderItem = (item: BranchesSidebarItem) => ReactNode;

interface MountedRow {
  readonly node: HTMLElement;
  readonly start: number;
}

interface RegionLayout {
  readonly items: readonly BranchesSidebarItem[];
  readonly rows: ReadonlyMap<string, MountedRow>;
}

const overscanRows = 12;
const regionPadding = 8;
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
  const { header, local, docked } = useMemo(() => dockItems(items), [items]);
  const top = header !== undefined || local.length > 0;
  return (
    <div
      aria-activedescendant={
        activeRowId === undefined ? undefined : rowElementId(activeRowId)
      }
      aria-busy={busy}
      aria-label="Branches"
      aria-multiselectable="true"
      className={`group/tree flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${busy ? "cursor-progress opacity-70" : ""}`}
      onKeyDown={onKeyDown}
      ref={treeRef}
      role="tree"
      tabIndex={0}
    >
      {children}
      {top ? (
        <div
          className={`flex flex-1 basis-0 flex-col ${local.length > 0 && docked.length > 0 ? "min-h-[40%]" : "min-h-8"}`}
        >
          {header === undefined ? null : (
            <div className="mx-2 shrink-0">{renderItem(header)}</div>
          )}
          <VirtualRegion
            activeRowId={activeRowId}
            fill
            items={local}
            padding={0}
            renderItem={renderItem}
          />
        </div>
      ) : null}
      {docked.length === 0 ? null : (
        <VirtualRegion
          activeRowId={activeRowId}
          fill={!top}
          items={docked}
          padding={regionPadding}
          renderItem={renderItem}
        />
      )}
    </div>
  );
}

function VirtualRegion({
  activeRowId,
  fill,
  items,
  padding,
  renderItem,
}: {
  readonly activeRowId: string | undefined;
  readonly fill: boolean;
  readonly items: readonly BranchesSidebarItem[];
  readonly padding: number;
  readonly renderItem: RenderItem;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => estimateItemHeight(items[index]),
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: overscanRows,
    paddingEnd: padding,
    paddingStart: padding,
  });
  useRowMotion(listRef, items, virtualizer);

  const draftIndex = items.findIndex(
    (item) => item.kind === "draft" || item.kind === "stash-draft",
  );
  useEffect(() => {
    if (draftIndex >= 0) virtualizer.scrollToIndex(draftIndex);
  }, [draftIndex, virtualizer]);

  useEffect(() => {
    if (activeRowId === undefined) return;
    const index = items.findIndex((item) => item.id === activeRowId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [activeRowId, items, virtualizer]);

  const height = virtualizer.getTotalSize();
  return (
    <div
      className={`min-h-0 overflow-x-hidden overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${fill ? "flex-1" : "transition-[height] duration-150 ease-out motion-reduce:transition-none"}`}
      ref={scrollRef}
      style={fill ? undefined : { height }}
      tabIndex={-1}
    >
      <div className="relative w-full" ref={listRef} style={{ height }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          return item === undefined ? null : (
            <div
              className="absolute top-0 left-0 w-full bg-sidebar"
              data-index={virtualItem.index}
              key={item.id}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useRowMotion(
  listRef: RefObject<HTMLDivElement | null>,
  items: readonly BranchesSidebarItem[],
  virtualizer: Virtualizer<HTMLDivElement, Element>,
) {
  const previous = useRef<RegionLayout>(undefined);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const before = previous.current;
    const after = { items, rows: mountedRows(list, items, virtualizer) };
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
  items: readonly BranchesSidebarItem[],
  virtualizer: Virtualizer<HTMLDivElement, Element>,
): Map<string, MountedRow> {
  const nodes = new Map(
    Array.from(list.children).flatMap((node) =>
      node instanceof HTMLElement && node.dataset.index !== undefined
        ? [[Number(node.dataset.index), node]]
        : [],
    ),
  );
  return new Map(
    virtualizer.getVirtualItems().flatMap(({ index, start }) => {
      const id = items[index]?.id;
      const node = nodes.get(index);
      return id === undefined || node === undefined
        ? []
        : [[id, { node, start }]];
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
  for (const [, { node }] of exiting) fadeOut(list, node);
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

function fadeOut(list: HTMLElement, node: HTMLElement) {
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
