import {
  IconArrowDown,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
} from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "#web/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu";
import { useFileRows } from "#web/features/file-diff/hooks/use-file-rows";
import { ChangeFileIcon } from "#web/features/working-changes/components/change-file-icon";
import { MarkersConfirmation } from "#web/features/working-changes/conflicts/components/markers-confirmation";
import { conflictLabel } from "#web/features/working-changes/conflicts/conflict-labels";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view";

export type ConflictFileSectionView = Pick<
  WorkingChangesView,
  "conflicts" | "preferences" | "selection" | "select" | "busy" | "loading"
>;

export function ConflictFileSection({
  view,
  filter,
  writable,
  openMergeView,
}: {
  readonly view: ConflictFileSectionView;
  readonly filter: string;
  readonly writable: boolean;
  readonly openMergeView: ((path: string) => void) | undefined;
}) {
  const { conflicts, preferences, selection } = view;
  const [open, setOpen] = useState(true);
  const { rows, collapsed, scrollRef, virtualizer, toggle } = useFileRows(
    conflicts.rows,
    { tree: preferences.tree, filter, open },
  );
  if (conflicts.rows.length === 0) return null;
  const disabled = !writable || view.busy || view.loading;
  return (
    <section
      aria-label="Conflicted files"
      className={`flex min-h-0 flex-col border-border border-t ${open ? "flex-1" : "shrink-0"}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 bg-muted px-2">
        <Button
          variant="ghost"
          size="xs"
          className="min-w-0 flex-1 justify-start gap-2"
          aria-label={`${open ? "Collapse" : "Expand"} conflicts`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <IconChevronDown /> : <IconChevronRight />}
          <span>
            Conflicts{" "}
            <span className="text-status-connecting">
              {conflicts.rows.length}
            </span>
          </span>
        </Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const conflict = row.file;
            const chosen =
              selection?.section === "conflicts" && selection.path === row.key;
            const style = {
              transform: `translateY(${item.start}px)`,
              paddingLeft: 6 + row.depth * 12,
            };
            const className = `group absolute inset-x-0 flex h-8 items-center gap-1 rounded-md pr-1 ${chosen ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"}`;
            if (conflict === undefined)
              return (
                <div key={row.key} className={className} style={style}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                    aria-label={`Folder ${row.key}`}
                    aria-expanded={!collapsed.has(row.key)}
                    onClick={() => toggle(row.key)}
                  >
                    {collapsed.has(row.key) ? (
                      <IconChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <IconFolder className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.name}</span>
                  </button>
                </div>
              );
            const path = conflict.path;
            return (
              <ContextMenu key={row.key}>
                <ContextMenuTrigger
                  render={<div className={className} style={style} />}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                    aria-label={`Conflict ${path}`}
                    aria-pressed={chosen}
                    onClick={() => view.select({ section: "conflicts", path })}
                  >
                    <span className="size-3 shrink-0" />
                    <ChangeFileIcon path={path} />
                    <span className="truncate">{row.name}</span>
                  </button>
                  {conflicts.pending === path ? (
                    <MarkersConfirmation
                      path={path}
                      disabled={disabled}
                      cancel={conflicts.cancelResolve}
                      confirm={() => conflicts.resolve(path, true)}
                    />
                  ) : (
                    <>
                      {conflict.file ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {conflictLabel(conflict.file, conflicts.list?.sides)}
                        </span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Mark ${path} resolved`}
                        disabled={disabled || conflict.file === undefined}
                        onClick={() => conflicts.resolve(path, false)}
                      >
                        <IconArrowDown />
                      </Button>
                      <span className="size-7 shrink-0 sm:size-6" />
                    </>
                  )}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    disabled={openMergeView === undefined}
                    onClick={() => openMergeView?.(path)}
                  >
                    Merge view
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        {open && rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No matching files</p>
        ) : null}
      </div>
    </section>
  );
}
