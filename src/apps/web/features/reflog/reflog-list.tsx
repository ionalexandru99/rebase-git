import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { type KeyboardEvent, type MouseEvent, useMemo, useState } from "react";
import type { ReflogEntry } from "#contracts/repository-reflog/repository-reflog.contract.ts";
import {
  type Action,
  ActionMenuItems,
  keyAction,
  runAction,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { useNow } from "#web/lib/age-label.ts";

export interface ReflogRow {
  readonly id: string;
  readonly oid: string;
  readonly action: string;
  readonly description: string;
  readonly subject: string;
  readonly range: string;
  readonly recordedAt: number;
  readonly orphaned: boolean;
  readonly nested: boolean;
  readonly group?: { readonly expanded: boolean };
}

export function ReflogList({
  entries,
  status,
  truncated,
  actionsFor,
  onShowInGraph,
}: {
  readonly entries: readonly ReflogEntry[] | undefined;
  readonly status: "pending" | "error" | "success";
  readonly truncated: boolean;
  readonly actionsFor: (row: ReflogRow) => readonly Action[];
  readonly onShowInGraph: (oid: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string>();
  const rows = useMemo(
    () => (entries === undefined ? [] : reflogRows(entries, expanded)),
    [entries, expanded],
  );
  const active = rows.find((row) => row.id === activeId) ?? rows[0];

  const toggleGroup = (row: ReflogRow, open: boolean) => {
    if (row.group === undefined || row.group.expanded === open) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      if (open) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
  };

  const moveTo = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;
    setActiveId(row.id);
    document
      .getElementById(rowElementId(row.id))
      ?.scrollIntoView({ block: "nearest" });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (active === undefined) return;
    const index = rows.indexOf(active);
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
      openMenu(active);
    else if (event.key === "ArrowDown") moveTo(index + 1);
    else if (event.key === "ArrowUp") moveTo(index - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(rows.length - 1);
    else if (event.key === "ArrowRight") toggleGroup(active, true);
    else if (event.key === "ArrowLeft") toggleGroup(active, false);
    else if (!runAction(keyAction(actionsFor(active), event.key))) return;
    event.preventDefault();
  };

  const selectRow = (event: MouseEvent<HTMLElement>) => {
    const id = (event.target as Element)
      .closest("[data-row-id]")
      ?.getAttribute("data-row-id");
    if (id === null || id === undefined) {
      if (event.type === "contextmenu") event.stopPropagation();
      return;
    }
    setActiveId(id);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            aria-activedescendant={
              active === undefined ? undefined : rowElementId(active.id)
            }
            aria-label="Reflog entries"
            className="min-h-0 flex-1 overflow-y-auto py-1 text-[.8rem] outline-none"
            onClick={selectRow}
            onContextMenuCapture={selectRow}
            onDoubleClick={() => {
              if (active !== undefined) onShowInGraph(active.oid);
            }}
            onKeyDown={handleKeyDown}
            role="tree"
            tabIndex={0}
          >
            <ReflogRows
              activeId={active?.id}
              onToggle={toggleGroup}
              rows={rows}
              status={status}
            />
            {truncated ? (
              <p className="px-3 pt-2 text-[.7rem] text-muted-foreground">
                Showing the newest 2,000 entries.
              </p>
            ) : null}
          </div>
        }
      />
      <ContextMenuContent className="w-auto min-w-64">
        {active === undefined ? null : (
          <ActionMenuItems actions={actionsFor(active)} />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ReflogRows({
  rows,
  activeId,
  status,
  onToggle,
}: {
  readonly rows: readonly ReflogRow[];
  readonly activeId: string | undefined;
  readonly status: "pending" | "error" | "success";
  readonly onToggle: (row: ReflogRow, open: boolean) => void;
}) {
  const now = useNow();
  if (rows.length === 0)
    return (
      <div className="px-4 py-6 text-muted-foreground">
        {status === "pending" ? null : status === "error" ? (
          <p>The reflog could not be read.</p>
        ) : (
          <p className="text-foreground">No reflog entries yet.</p>
        )}
      </div>
    );
  const headings = dayHeadings(rows, now);
  return rows.map((row, index) => {
    const heading = headings[index];
    return (
      <div key={row.id}>
        {heading === undefined ? null : (
          <p
            aria-hidden="true"
            className="px-3 pt-2.5 pb-1 text-[.68rem] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {heading}
          </p>
        )}
        <div
          aria-expanded={row.group?.expanded}
          aria-level={row.nested ? 2 : 1}
          aria-selected={row.id === activeId}
          className={`grid h-7 cursor-default grid-cols-[14px_4.25rem_minmax(0,1fr)_auto_2.5rem] items-center gap-2 pr-3 whitespace-nowrap select-none aria-selected:bg-primary/12 ${row.nested ? "pl-8 text-muted-foreground" : "pl-3"}`}
          data-row-id={row.id}
          id={rowElementId(row.id)}
          role="treeitem"
          tabIndex={-1}
        >
          <RowMarker onToggle={onToggle} row={row} />
          <span className="font-mono text-[.7rem] text-muted-foreground">
            {row.action}
          </span>
          <span className="truncate">{row.description}</span>
          <span className="text-right font-mono text-[.72rem] text-muted-foreground">
            {row.range}
          </span>
          <span className="text-right text-[.72rem] text-muted-foreground">
            {row.nested ? "" : timeLabel(row.recordedAt)}
          </span>
        </div>
      </div>
    );
  });
}

function RowMarker({
  row,
  onToggle,
}: {
  readonly row: ReflogRow;
  readonly onToggle: (row: ReflogRow, open: boolean) => void;
}) {
  const group = row.group;
  if (group !== undefined)
    return (
      <button
        aria-label={group.expanded ? "Collapse steps" : "Expand steps"}
        className="grid size-3.5 place-items-center text-muted-foreground"
        onClick={() => onToggle(row, !group.expanded)}
        tabIndex={-1}
        type="button"
      >
        {group.expanded ? (
          <IconChevronDown aria-hidden="true" className="size-3.5" />
        ) : (
          <IconChevronRight aria-hidden="true" className="size-3.5" />
        )}
      </button>
    );
  return row.orphaned ? (
    <span
      aria-label="Only the reflog reaches this commit"
      className="size-[7px] justify-self-center rounded-full border-[1.5px] border-(--lane-2)"
      role="img"
    />
  ) : (
    <span
      aria-hidden="true"
      className="size-[7px] justify-self-center rounded-full bg-muted-foreground/55"
    />
  );
}

function reflogRows(
  entries: readonly ReflogEntry[],
  expanded: ReadonlySet<string>,
): ReflogRow[] {
  return entries.flatMap((entry, index) => {
    const id = `${entries.length - index}`;
    const open = expanded.has(id);
    const row: ReflogRow = {
      id,
      oid: entry.oid,
      action: entry.action,
      description: entry.description,
      subject: entry.subject,
      range:
        entry.previousOid === null ||
        entry.action === "commit" ||
        entry.action === "switch"
          ? short(entry.oid)
          : `${short(entry.previousOid)} → ${short(entry.oid)}`,
      recordedAt: entry.recordedAt,
      orphaned: entry.orphaned,
      nested: false,
      ...(entry.steps.length === 0 ? {} : { group: { expanded: open } }),
    };
    if (!open) return [row];
    return [
      row,
      ...entry.steps.map(
        (step, stepIndex): ReflogRow => ({
          id: `${id}.${stepIndex}`,
          oid: step.oid,
          action: step.label,
          description: step.description,
          subject: step.description,
          range: short(step.oid),
          recordedAt: entry.recordedAt,
          orphaned: false,
          nested: true,
        }),
      ),
    ];
  });
}

function openMenu(row: ReflogRow) {
  const element = document.getElementById(rowElementId(row.id));
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

function rowElementId(id: string) {
  return `reflog-row-${id.replace(".", "-")}`;
}

export function short(oid: string | null) {
  return oid === null ? "unknown" : oid.slice(0, 7);
}

function dayLabel(seconds: number, now: number) {
  const date = new Date(seconds * 1_000);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return "Today";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function timeLabel(seconds: number) {
  return new Date(seconds * 1_000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayHeadings(rows: readonly ReflogRow[], now: number) {
  let day: string | undefined;
  return rows.map((row) => {
    const rowDay = row.nested ? day : dayLabel(row.recordedAt, now);
    const heading = rowDay !== day ? rowDay : undefined;
    day = rowDay;
    return heading;
  });
}
