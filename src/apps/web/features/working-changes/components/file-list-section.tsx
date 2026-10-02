import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";
import { useFileRows } from "#web/features/file-diff/hooks/use-file-rows.ts";
import { ChangeFileIcon } from "#web/features/working-changes/components/change-file-icon.tsx";
import { cn } from "#web/lib/utils.ts";

interface FileRowContext<File extends { readonly path: string }> {
  readonly rows: readonly ChangeTreeRow<File>[];
  readonly index: number;
  readonly collapsed: ReadonlySet<string>;
  readonly toggle: (key: string) => void;
}

export function FileListSection<File extends { readonly path: string }>({
  name,
  title,
  countClassName = "text-muted-foreground",
  files,
  tree,
  filter,
  action,
  notice,
  footer,
  chosen,
  menu,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly countClassName?: string;
  readonly files: readonly File[];
  readonly tree: boolean;
  readonly filter: string;
  readonly action?: ReactNode;
  readonly notice?: ReactNode;
  readonly footer?: (open: boolean) => ReactNode;
  readonly chosen: (row: ChangeTreeRow<File>) => boolean;
  readonly menu?: (row: ChangeTreeRow<File>) => readonly Action[];
  readonly children: (
    row: ChangeTreeRow<File>,
    context: FileRowContext<File>,
  ) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const { rows, collapsed, scrollRef, virtualizer, toggle } = useFileRows(
    files,
    { tree, filter, open },
  );
  return (
    <section
      aria-label={name}
      className={`flex min-h-0 flex-col border-border border-t ${open && files.length ? "flex-1" : "shrink-0"}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 bg-muted px-2">
        <Button
          variant="ghost"
          size="xs"
          className="min-w-0 flex-1 justify-start gap-2"
          aria-label={`${open ? "Collapse" : "Expand"} ${title.toLowerCase()}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <IconChevronDown /> : <IconChevronRight />}
          <span>
            {title} <span className={countClassName}>{files.length}</span>
          </span>
        </Button>
        {action}
      </div>
      {open ? notice : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const element = (
              <div
                key={row.key}
                className={cn(
                  "group absolute inset-x-0 flex h-8 items-center gap-1 rounded-md pr-1",
                  chosen(row)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/75",
                )}
                style={{
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 6 + row.depth * 12,
                }}
              >
                {children(row, {
                  rows,
                  index: item.index,
                  collapsed,
                  toggle,
                })}
              </div>
            );
            return menu === undefined ? (
              element
            ) : (
              <ContextMenu key={row.key}>
                <ContextMenuTrigger render={element} />
                <ContextMenuContent className="w-max min-w-48 max-w-md">
                  <ActionMenuItems actions={menu(row)} />
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        {open && files.length > 0 && rows.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No matching files</p>
        ) : null}
      </div>
      {footer?.(open)}
    </section>
  );
}

export function RowLead<File extends { readonly path: string }>({
  row,
  collapsed,
}: {
  readonly row: ChangeTreeRow<File>;
  readonly collapsed: ReadonlySet<string>;
}) {
  if (row.file !== undefined)
    return (
      <>
        <span className="size-3 shrink-0" />
        <ChangeFileIcon path={row.key} />
      </>
    );
  return (
    <>
      {collapsed.has(row.key) ? (
        <IconChevronRight className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
      )}
      <IconFolder className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}
