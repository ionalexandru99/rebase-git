import type { RepositoryRefTarget } from "@rebase/contracts";
import { IconSearch } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type JSX,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BranchesSidebarRow } from "#web/features/branches-sidebar/branches-sidebar.contract";
import { describeRepositoryRefsError } from "#web/features/branches-sidebar/branches-sidebar-messages";
import {
  buildBranchesSidebarRows,
  currentRefRowId,
  defaultExpandedSections,
  sectionRowId,
  stepRow,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state";
import { keyboardShortcutAria } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import {
  RefRow,
  rowElementId,
  SectionRow,
} from "#web-ui/features/branches-sidebar/branches-sidebar-rows";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

const rowHeight = 32;
const overscanRows = 12;

export function BranchesSidebar({
  activeWorktreePath,
  focusRequest,
  onRetry,
  onSelectRef,
  snapshot,
}: {
  readonly activeWorktreePath: string;
  readonly focusRequest: number;
  readonly onRetry: () => void;
  readonly onSelectRef: (target: RepositoryRefTarget) => void;
  readonly snapshot: RepositoryRefsSnapshot;
}): JSX.Element {
  const { bindings, platform } = useKeyboardShortcuts();
  const focusBinding = bindings["branches.focusSidebar"];
  const [query, setQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState(
    defaultExpandedSections,
  );
  const [activeRowId, setActiveRowId] = useState<string>();
  const treeRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const refs = snapshot.refs;
  const rows = useMemo(
    () =>
      refs === undefined
        ? []
        : buildBranchesSidebarRows(
            refs,
            activeWorktreePath,
            expandedSections,
            query,
          ),
    [activeWorktreePath, expandedSections, query, refs],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => treeRef.current,
    overscan: overscanRows,
  });

  useEffect(() => {
    if (
      activeRowId !== undefined &&
      !rows.some((row) => row.id === activeRowId)
    ) {
      setActiveRowId(undefined);
    }
  }, [activeRowId, rows]);

  useEffect(() => {
    if (activeRowId === undefined) return;
    const index = rows.findIndex((row) => row.id === activeRowId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [activeRowId, rows, virtualizer]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    if (focusRequest === 0) return;
    treeRef.current?.focus();
    setActiveRowId(
      (current) =>
        current ?? currentRefRowId(rowsRef.current) ?? rowsRef.current[0]?.id,
    );
  }, [focusRequest]);

  const activateRow = (row: BranchesSidebarRow) => {
    if (row.kind === "section") {
      setExpandedSections((current) => toggleSection(current, row.sectionId));
    } else {
      onSelectRef(row.target);
    }
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const activeRow = rows.find((row) => row.id === activeRowId);
    const handled = treeKeyAction(event.key, {
      activeRow,
      collapse: (sectionId) =>
        setExpandedSections((current) =>
          current.has(sectionId) ? toggleSection(current, sectionId) : current,
        ),
      expand: (sectionId) =>
        setExpandedSections((current) =>
          current.has(sectionId) ? current : toggleSection(current, sectionId),
        ),
      focusFilter: () => {
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      },
      hasQuery: query.length > 0,
      rows,
      setActive: setActiveRowId,
      activate: activateRow,
      clearQuery: () => setQuery(""),
    });
    if (handled) event.preventDefault();
  };

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      treeRef.current?.focus();
      setActiveRowId(
        (current) => current ?? currentRefRowId(rows) ?? rows[0]?.id,
      );
      return;
    }
    if (event.key === "Enter") {
      const activeRow = rows.find((row) => row.id === activeRowId);
      if (activeRow?.kind === "ref") {
        event.preventDefault();
        onSelectRef(activeRow.target);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query.length > 0) setQuery("");
      else treeRef.current?.focus();
    }
  };

  return (
    <nav
      aria-label="Branches"
      className="flex h-full min-h-0 flex-col overflow-hidden border-sidebar-border/50 border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-11 shrink-0 items-center px-4 text-sidebar-accent-foreground">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          Branches
        </h2>
      </div>
      <div className="relative mx-3 mt-3 mb-1.5">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-keyshortcuts="/"
          aria-label="Filter branches"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleFilterKeyDown}
          placeholder="Filter branches"
          ref={filterInputRef}
          value={query}
        />
      </div>
      <div
        aria-activedescendant={
          activeRowId === undefined ? undefined : rowElementId(activeRowId)
        }
        aria-busy={snapshot.checkingOut}
        aria-keyshortcuts={keyboardShortcutAria(focusBinding, platform)}
        aria-label="Branches"
        className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] px-2 pb-2 outline-none [&::-webkit-scrollbar]:hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${snapshot.checkingOut ? "cursor-progress opacity-70" : ""}`}
        data-slot="branches-scroll"
        onKeyDown={handleTreeKeyDown}
        ref={treeRef}
        role="tree"
        tabIndex={0}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) return null;
            const style = {
              height: item.size,
              transform: `translateY(${item.start}px)`,
            };
            return row.kind === "section" ? (
              <SectionRow
                active={row.id === activeRowId}
                key={row.id}
                onActivate={() => setActiveRowId(row.id)}
                onToggle={() => activateRow(row)}
                row={row}
                style={style}
              />
            ) : (
              <RefRow
                active={row.id === activeRowId}
                key={row.id}
                onActivate={() => setActiveRowId(row.id)}
                onSelect={() => onSelectRef(row.target)}
                row={row}
                style={style}
              />
            );
          })}
        </div>
        <SidebarStatus onRetry={onRetry} rows={rows} snapshot={snapshot} />
      </div>
      {snapshot.checkoutError === undefined ? null : (
        <p
          className="mx-3 mb-3 rounded-md border border-status-unavailable/40 bg-status-unavailable/10 px-3 py-2 text-xs text-foreground"
          role="alert"
        >
          {describeRepositoryRefsError(snapshot.checkoutError)}
        </p>
      )}
    </nav>
  );
}

function SidebarStatus({
  onRetry,
  rows,
  snapshot,
}: {
  readonly onRetry: () => void;
  readonly rows: readonly BranchesSidebarRow[];
  readonly snapshot: RepositoryRefsSnapshot;
}): JSX.Element | null {
  if (snapshot.error !== undefined) {
    return (
      <div className="px-2 py-3 text-xs text-status-unavailable" role="alert">
        <p>{describeRepositoryRefsError(snapshot.error)}</p>
        <Button className="mt-2" onClick={onRetry} size="xs" variant="outline">
          Retry
        </Button>
      </div>
    );
  }
  if (snapshot.refs === undefined) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
        {snapshot.status === "loading"
          ? "Loading branches…"
          : "No repository selected."}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
        No branches match.
      </p>
    );
  }
  return null;
}

function treeKeyAction(
  key: string,
  actions: {
    readonly activate: (row: BranchesSidebarRow) => void;
    readonly activeRow: BranchesSidebarRow | undefined;
    readonly clearQuery: () => void;
    readonly collapse: (sectionId: string) => void;
    readonly expand: (sectionId: string) => void;
    readonly focusFilter: () => void;
    readonly hasQuery: boolean;
    readonly rows: readonly BranchesSidebarRow[];
    readonly setActive: (rowId: string | undefined) => void;
  },
): boolean {
  const { activeRow, rows } = actions;
  switch (key) {
    case "ArrowDown":
      actions.setActive(stepRow(rows, activeRow?.id, 1));
      return true;
    case "ArrowUp":
      actions.setActive(stepRow(rows, activeRow?.id, -1));
      return true;
    case "Home":
      actions.setActive(rows[0]?.id);
      return true;
    case "End":
      actions.setActive(rows.at(-1)?.id);
      return true;
    case "ArrowRight":
      if (activeRow?.kind !== "section") return false;
      if (activeRow.expanded) actions.setActive(stepRow(rows, activeRow.id, 1));
      else actions.expand(activeRow.sectionId);
      return true;
    case "ArrowLeft":
      if (activeRow === undefined) return false;
      if (activeRow.kind === "ref")
        actions.setActive(sectionRowId(activeRow.sectionId));
      else actions.collapse(activeRow.sectionId);
      return true;
    case "Enter":
    case " ":
      if (activeRow === undefined) return false;
      actions.activate(activeRow);
      return true;
    case "/":
      actions.focusFilter();
      return true;
    case "Escape":
      if (!actions.hasQuery) return false;
      actions.clearQuery();
      return true;
    default:
      return false;
  }
}
