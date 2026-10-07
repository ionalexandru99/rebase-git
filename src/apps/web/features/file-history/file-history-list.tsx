import { IconGitCommit } from "@tabler/icons-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffectEvent,
  useId,
} from "react";
import type { FileHistoryEntry } from "#contracts/file-history/file-history.contract.ts";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { LineCounts } from "#web/features/file-diff/components/file-row-name.tsx";

export function HistoryList({
  entries,
  active,
  complete,
  onSelect,
  onLoadMore,
  actionsFor,
  onMenuClose,
}: {
  readonly entries: readonly FileHistoryEntry[];
  readonly active: FileHistoryEntry;
  readonly complete: boolean;
  readonly onSelect: (entry: FileHistoryEntry) => void;
  readonly onLoadMore: () => void;
  readonly actionsFor: (entry: FileHistoryEntry) => readonly Action[];
  readonly onMenuClose: () => void;
}) {
  const listId = useId();
  const rowId = (oid: string) => `${listId}-${oid}`;
  const loadMore = useEffectEvent(onLoadMore);
  const observeEnd = (node: HTMLDivElement) => {
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  };

  const moveTo = (index: number) => {
    const next = entries[Math.max(0, Math.min(entries.length - 1, index))];
    if (next === undefined) return;
    onSelect(next);
    document
      .getElementById(rowId(next.oid))
      ?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = entries.indexOf(active);
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
      openMenu(rowId(active.oid));
    else if (event.key === "ArrowDown") moveTo(index + 1);
    else if (event.key === "ArrowUp") moveTo(index - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(entries.length - 1);
    else return;
    event.preventDefault();
  };
  const selectRow = (event: MouseEvent<HTMLElement>) => {
    const oid = (event.target as Element)
      .closest("[data-oid]")
      ?.getAttribute("data-oid");
    const row = entries.find((candidate) => candidate.oid === oid);
    if (row === undefined) {
      if (event.type === "contextmenu") event.stopPropagation();
      return;
    }
    if (row !== active) onSelect(row);
  };
  return (
    <div className="flex h-full min-h-0 flex-col border-border border-l bg-sidebar pb-1">
      <div className="mx-1 mt-1 flex h-8 shrink-0 items-center gap-2 px-1.5 text-[.8rem] text-sidebar-foreground">
        <IconGitCommit aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          Commits ({entries.length.toLocaleString()}
          {complete ? "" : "+"})
        </span>
        <span
          aria-hidden="true"
          className="h-px min-w-3 flex-1 bg-current opacity-40"
        />
      </div>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) onMenuClose();
        }}
      >
        <ContextMenuTrigger
          render={
            <div
              aria-activedescendant={rowId(active.oid)}
              aria-label="Commits"
              className="min-h-0 flex-1 overflow-y-auto px-1 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
              onClick={selectRow}
              onContextMenuCapture={selectRow}
              onKeyDown={onKeyDown}
              role="listbox"
              tabIndex={0}
            >
              {entries.map((row) => (
                <HistoryRow
                  key={row.oid}
                  id={rowId(row.oid)}
                  entry={row}
                  chosen={row === active}
                />
              ))}
              {complete ? null : (
                <div key={entries.length} ref={observeEnd} className="h-px" />
              )}
            </div>
          }
        />
        <ContextMenuContent className="w-max min-w-48 max-w-md">
          <ActionMenuItems actions={actionsFor(active)} />
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function HistoryRow({
  id,
  entry,
  chosen,
}: {
  readonly id: string;
  readonly entry: FileHistoryEntry;
  readonly chosen: boolean;
}) {
  return (
    <div
      aria-selected={chosen}
      className={`flex h-11 cursor-default flex-col justify-center rounded-control pr-1 pl-2.5 text-[.85rem] select-none ${
        chosen
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground"
      }`}
      data-oid={entry.oid}
      id={id}
      role="option"
      tabIndex={-1}
    >
      <span className="truncate leading-tight">{entry.subject}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[.72rem] leading-tight text-muted-foreground">
        <span className="shrink-0">{entry.oid.slice(0, 8)}</span>
        <span className="shrink-0">{dateLabel(entry.authoredAt)}</span>
        <StatusHint entry={entry} />
        {entry.status === "D" ? null : (
          <LineCounts className="ml-auto shrink-0" lines={entry.lines} />
        )}
      </span>
    </div>
  );
}

function StatusHint({ entry }: { readonly entry: FileHistoryEntry }) {
  if (entry.previousPath !== null)
    return (
      <span className="min-w-0 truncate text-sky-600 dark:text-sky-400">
        ← {entry.previousPath.split("/").slice(-2).join("/")}
      </span>
    );
  if (entry.status === "A")
    return (
      <span className="text-emerald-600 dark:text-emerald-400">Added</span>
    );
  if (entry.status === "D")
    return <span className="text-rose-600 dark:text-rose-400">Deleted</span>;
  return null;
}

function openMenu(id: string) {
  const element = document.getElementById(id);
  if (element === null) return;
  const bounds = element.getBoundingClientRect();
  element.dispatchEvent(
    new globalThis.MouseEvent("contextmenu", {
      bubbles: true,
      clientX: bounds.left + 48,
      clientY: bounds.bottom,
    }),
  );
}

const thisYear = new Date().getFullYear();
const shortDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const longDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function dateLabel(seconds: number) {
  const date = new Date(seconds * 1_000);
  return (date.getFullYear() === thisYear ? shortDate : longDate).format(date);
}
