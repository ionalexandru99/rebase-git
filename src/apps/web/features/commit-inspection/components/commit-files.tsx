import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
} from "@tabler/icons-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  useRef,
  useState,
} from "react";
import type { CommitFile } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";
import { useFileRows } from "#web/features/file-diff/hooks/use-file-rows.ts";

const statusLabels: Record<CommitFile["status"], string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  T: "Type changed",
};

export function CommitFiles({
  files,
  path,
  select,
  actionsFor,
  onMenuClose,
}: {
  readonly files: readonly CommitFile[];
  readonly path: string | null;
  readonly select: (path: string) => void;
  readonly actionsFor: (
    paths: readonly string[],
    anchor: string,
  ) => readonly Action[];
  readonly onMenuClose: () => void;
}) {
  const { rows, collapsed, scrollRef, virtualizer, toggle } = useFileRows(
    files,
    { rowHeight: (row) => (row.file?.previousPath ? 52 : 32) },
  );
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const chosen = [...checked].filter((key) =>
    files.some((file) => file.path === key),
  );
  const targets = chosen.length > 0 ? chosen : path === null ? [] : [path];
  const actions =
    path === null || !targets.includes(path) ? [] : actionsFor(targets, path);

  const click = (
    event: MouseEvent<HTMLButtonElement>,
    row: ChangeTreeRow<CommitFile>,
    index: number,
  ) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      const start = rows.findIndex((entry) => entry.key === anchor.current);
      const paths =
        event.shiftKey && start >= 0
          ? rows
              .slice(Math.min(start, index), Math.max(start, index) + 1)
              .flatMap((entry) => (entry.file ? entry.paths : []))
          : row.paths;
      setChecked((current) => {
        const next = new Set(event.shiftKey ? [] : current);
        if (next.size === 0 && path !== null && !event.shiftKey) next.add(path);
        const remove =
          !event.shiftKey && paths.every((entry) => next.has(entry));
        for (const entry of paths) {
          if (remove) next.delete(entry);
          else next.add(entry);
        }
        return next;
      });
      if (!event.shiftKey) anchor.current = row.key;
      return;
    }
    anchor.current = row.key;
    if (row.file === undefined) {
      toggle(row.key);
      return;
    }
    setChecked(new Set([row.file.path]));
    select(row.file.path);
  };

  const pick = (
    event: MouseEvent<HTMLElement>,
    row: ChangeTreeRow<CommitFile>,
  ) => {
    const target = row.file?.path ?? row.paths[0];
    if (target === undefined) {
      event.stopPropagation();
      return;
    }
    if (!row.paths.every((entry) => targets.includes(entry))) {
      anchor.current = row.key;
      setChecked(new Set(row.paths));
    }
    if (actionsFor(row.paths, target).length === 0) event.stopPropagation();
    select(target);
  };

  const openMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))
      return;
    event.preventDefault();
    const row = event.currentTarget;
    const bounds = row.getBoundingClientRect();
    row.dispatchEvent(
      new globalThis.MouseEvent("contextmenu", {
        bubbles: true,
        clientX: bounds.left + 32,
        clientY: bounds.bottom,
      }),
    );
  };

  const list: ReactElement = (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        const file = row.file;
        return (
          <button
            type="button"
            aria-pressed={
              file !== undefined
                ? path === file.path || chosen.includes(file.path)
                : undefined
            }
            aria-expanded={
              file === undefined ? !collapsed.has(row.key) : undefined
            }
            aria-label={
              file
                ? `${file.path} ${statusLabels[file.status]}${file.previousPath ? ` from ${file.previousPath}` : ""}`
                : row.key
            }
            key={row.key}
            className="absolute inset-x-0 cursor-default py-1.5 pr-3 text-left text-xs aria-pressed:bg-primary/15 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-inset"
            style={{
              top: item.start,
              height: item.size,
              paddingLeft: 10 + row.depth * 12,
            }}
            onClick={(event) => click(event, row, item.index)}
            onContextMenu={(event) => pick(event, row)}
            onKeyDown={openMenu}
          >
            <div className="flex items-center gap-1.5">
              {file ? null : (
                <>
                  {collapsed.has(row.key) ? (
                    <IconChevronRight className="size-3 shrink-0" />
                  ) : (
                    <IconChevronDown className="size-3 shrink-0" />
                  )}
                  <IconFolder className="size-3 shrink-0 text-muted-foreground" />
                </>
              )}
              <span className="min-w-0 flex-1 truncate font-mono">
                {row.name}
              </span>
              {file ? (
                <span
                  aria-hidden="true"
                  className={
                    file.status === "A"
                      ? "text-green-400"
                      : file.status === "D"
                        ? "text-red-400"
                        : "text-muted-foreground"
                  }
                >
                  {file.status}
                </span>
              ) : null}
            </div>
            {file?.previousPath ? (
              <div className="mt-1 truncate text-muted-foreground">
                from {file.previousPath}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <section
      className="flex min-h-0 flex-col border-border border-l"
      aria-label="Changed files"
    >
      <div className="flex shrink-0 items-center justify-between border-border border-b p-3 text-xs">
        Changed files{" "}
        <span className="text-muted-foreground">{files.length}</span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <ContextMenu
          onOpenChange={(open) => {
            if (!open) onMenuClose();
          }}
        >
          <ContextMenuTrigger render={list} />
          <ContextMenuContent className="w-auto min-w-48">
            <ActionMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </section>
  );
}
