import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
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

export interface ItemPlacement {
  readonly index: number;
  readonly position: CSSProperties;
  readonly size: number;
  readonly measure: (element: Element | null) => void;
}

type RenderItem = (
  item: BranchesSidebarItem,
  placement: ItemPlacement,
) => ReactNode;

const overscanRows = 12;
const regionPadding = 8;
const pinnedPlacement: ItemPlacement = {
  index: 0,
  position: {},
  size: 32,
  measure: () => undefined,
};

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
            <div className="relative mx-2 h-8 shrink-0">
              {renderItem(header, pinnedPlacement)}
            </div>
          )}
          <VirtualRegion
            activeRowId={activeRowId}
            className="min-h-0 flex-1"
            items={local}
            padding={0}
            renderItem={renderItem}
          />
        </div>
      ) : null}
      {docked.length === 0 ? null : (
        <VirtualRegion
          activeRowId={activeRowId}
          className={top ? "min-h-0" : "min-h-0 flex-1"}
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
  className,
  items,
  padding,
  renderItem,
}: {
  readonly activeRowId: string | undefined;
  readonly className: string;
  readonly items: readonly BranchesSidebarItem[];
  readonly padding: number;
  readonly renderItem: RenderItem;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => estimateItemHeight(items[index]),
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: overscanRows,
    paddingEnd: padding,
    paddingStart: padding,
  });
  useLayoutEffect(() => {
    if (items.length > 0) virtualizer.measure();
  }, [items, virtualizer]);

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

  return (
    <div
      className={`overflow-x-hidden overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      ref={scrollRef}
      tabIndex={-1}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          return item === undefined
            ? null
            : renderItem(item, {
                index: virtualItem.index,
                position: { transform: `translateY(${virtualItem.start}px)` },
                size: virtualItem.size,
                measure: virtualizer.measureElement,
              });
        })}
      </div>
    </div>
  );
}
