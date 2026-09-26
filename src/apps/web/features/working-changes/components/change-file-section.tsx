import type { ChangedFile, ChangeSection } from "@rebase/contracts";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconFolder,
  IconTrash,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useFileRows } from "#web/features/file-diff/index";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view";
import {
  compactRename,
  renameHint,
} from "#web/features/working-changes/rename/rename-path";
import { Button } from "#web-ui/components/ui/button";
import { ChangeFileIcon } from "#web-ui/features/working-changes/components/change-file-icon";

export type ChangeFileSectionView = Pick<
  WorkingChangesView,
  "changes" | "preferences" | "selection" | "select" | "busy" | "loading"
>;

const statusLabels: Record<ChangedFile["status"], string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  T: "Type changed",
  U: "Conflicted",
  "?": "Untracked",
};

export function ChangeFileSection({
  view,
  section,
  filter,
  writable,
  act,
}: {
  readonly view: ChangeFileSectionView;
  readonly section: ChangeSection;
  readonly filter: string;
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const { changes, preferences, selection, busy, loading } = view;
  const anchor = useRef<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(true);
  const files = changes?.[section] ?? [];
  const { rows, collapsed, scrollRef, virtualizer, toggle } = useFileRows(
    files,
    { tree: preferences.tree, filter, open },
  );
  const selected = files
    .filter((file) => checked.has(file.path))
    .map((file) => file.path);
  const disabled = !writable || busy || loading;
  const label = section === "unstaged" ? "Unstaged" : "Staged";
  const action = section === "unstaged" ? "stage" : "unstage";
  const actionLabel = section === "unstaged" ? "Stage" : "Unstage";
  const Arrow = section === "unstaged" ? IconArrowDown : IconArrowUp;
  const AllArrow = section === "unstaged" ? IconChevronsDown : IconChevronsUp;
  return (
    <section
      aria-label={`${label} files`}
      className={`flex min-h-0 flex-col border-border border-t ${open && files.length ? "flex-1" : "shrink-0"}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 bg-muted px-2">
        <Button
          variant="ghost"
          size="xs"
          className="min-w-0 flex-1 justify-start gap-2"
          aria-label={`${open ? "Collapse" : "Expand"} ${label.toLowerCase()}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <IconChevronDown /> : <IconChevronRight />}
          <span>
            {label}{" "}
            <span className="text-muted-foreground">{files.length}</span>
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${actionLabel} all`}
          disabled={disabled || files.length === 0}
          onClick={() => act(action, section, { _tag: "All" })}
        >
          <AllArrow />
        </Button>
      </div>
      {open && section === "staged" && changes?.renamesLimited ? (
        <p
          role="status"
          className="shrink-0 px-3 py-1.5 text-xs text-muted-foreground"
        >
          Too many changed files to match renames. Moved files show as deleted
          and added.
        </p>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const isFolder = row.file === undefined;
            const chosen =
              checked.has(row.key) ||
              (selection?.section === section && selection.path === row.key);
            const previousPath = row.file?.previousPath ?? null;
            return (
              <div
                key={row.key}
                className={`group absolute inset-x-0 flex h-8 items-center gap-1 rounded-md pr-1 ${chosen ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"}`}
                style={{
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 6 + row.depth * 12,
                }}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                  aria-label={`${isFolder ? "Folder" : label} ${row.key}${previousPath ? ` renamed from ${previousPath}` : ""}`}
                  aria-expanded={isFolder ? !collapsed.has(row.key) : undefined}
                  aria-pressed={row.paths.every((path) => checked.has(path))}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      const start = rows.findIndex(
                        (entry) => entry.key === anchor.current,
                      );
                      const paths =
                        event.shiftKey && start >= 0
                          ? rows
                              .slice(
                                Math.min(start, item.index),
                                Math.max(start, item.index) + 1,
                              )
                              .flatMap((entry) =>
                                entry.file ? entry.paths : [],
                              )
                          : row.paths;
                      setChecked((current) => {
                        const next = event.shiftKey
                          ? new Set<string>()
                          : new Set(current);
                        const remove =
                          !event.shiftKey &&
                          paths.every((path) => next.has(path));
                        for (const path of paths) {
                          if (remove) next.delete(path);
                          else next.add(path);
                        }
                        return next;
                      });
                      if (!event.shiftKey) anchor.current = row.key;
                      return;
                    }
                    anchor.current = row.key;
                    setChecked(new Set(isFolder ? [] : row.paths));
                    isFolder
                      ? toggle(row.key)
                      : view.select({ section, path: row.key });
                  }}
                >
                  {isFolder ? (
                    collapsed.has(row.key) ? (
                      <IconChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                  {isFolder ? (
                    <IconFolder className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChangeFileIcon path={row.key} />
                  )}
                  <span className="truncate">
                    {previousPath && !preferences.tree
                      ? compactRename(previousPath, row.key)
                      : row.name}
                  </span>
                  {previousPath && preferences.tree ? (
                    <span className="min-w-0 shrink-[100] truncate text-[11px] text-muted-foreground">
                      ← {renameHint(previousPath, row.key)}
                    </span>
                  ) : null}
                </button>
                {row.file ? (
                  <span
                    role="img"
                    className="shrink-0 text-[10px] text-muted-foreground"
                    aria-label={statusLabels[row.file.status]}
                  >
                    {row.file.status === "?" ? "A" : row.file.status}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${actionLabel} ${row.key}`}
                  disabled={disabled}
                  onClick={() =>
                    act(action, section, { _tag: "Files", paths: row.paths })
                  }
                >
                  <Arrow />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Discard ${label.toLowerCase()} ${row.key}`}
                  className="opacity-0 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                  disabled={disabled}
                  onClick={() =>
                    act("discard", section, { _tag: "Files", paths: row.paths })
                  }
                >
                  <IconTrash />
                </Button>
              </div>
            );
          })}
        </div>
        {open && rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {files.length ? "No matching files" : `No ${section} files`}
          </p>
        ) : null}
      </div>
      {open && selected.length > 1 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-t p-1.5">
          <span className="mr-auto text-xs text-muted-foreground">
            {selected.length} selected
          </span>
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              act("discard", section, { _tag: "Files", paths: selected })
            }
          >
            Discard
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              act(action, section, { _tag: "Files", paths: selected })
            }
          >
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
