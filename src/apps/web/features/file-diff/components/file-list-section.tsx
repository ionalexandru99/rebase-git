import {
  type Icon,
  IconChevronDown,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { ChangeFileIcon } from "#web/features/file-diff/components/change-file-icon.tsx";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";
import { useFileRows } from "#web/features/file-diff/hooks/use-file-rows.ts";
import { cn } from "#web/lib/utils.ts";

interface FileRowContext<File extends { readonly path: string }> {
  readonly rows: readonly ChangeTreeRow<File>[];
  readonly index: number;
  readonly collapsed: ReadonlySet<string>;
  readonly toggle: (key: string) => void;
}

export interface SectionLook {
  readonly Icon: Icon;
  readonly className: string;
}

export function FileListSection<File extends { readonly path: string }>({
  name,
  title,
  look,
  files,
  tree,
  filter,
  grow,
  headerMenu,
  notice,
  footer,
  chosen,
  menu,
  onMenuClose,
  onMenuOpen,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly look: SectionLook;
  readonly files: readonly File[];
  readonly tree: boolean;
  readonly filter: string;
  readonly grow: boolean;
  readonly headerMenu?: readonly Action[];
  readonly notice?: ReactNode;
  readonly footer?: (open: boolean) => ReactNode;
  readonly chosen: (row: ChangeTreeRow<File>) => boolean;
  readonly menu?: ((row: ChangeTreeRow<File>) => readonly Action[]) | undefined;
  readonly onMenuClose?: (() => void) | undefined;
  readonly onMenuOpen?: ((row: ChangeTreeRow<File>) => void) | undefined;
  readonly children: (
    row: ChangeTreeRow<File>,
    context: FileRowContext<File>,
  ) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const { rows, collapsed, scrollRef, items, totalSize, toggle } = useFileRows(
    files,
    {
      tree,
      filter,
      open,
      rowHeight: (row) => (tree || row.file === undefined ? 32 : 44),
    },
  );
  const filled = grow && open && files.length > 0;
  const header = (
    <button
      type="button"
      aria-label={`${open ? "Collapse" : "Expand"} ${title.toLowerCase()}`}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      onKeyDown={headerMenu === undefined ? undefined : openMenu}
      className={cn(
        "relative flex h-8 w-full cursor-default items-center gap-2 rounded-md px-1.5 text-left text-[.8rem] outline-none select-none hover:bg-sidebar-accent/50 focus-visible:ring-1 focus-visible:ring-sidebar-ring",
        look.className,
      )}
    >
      <look.Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {title} ({files.length})
      </span>
      <span
        aria-hidden="true"
        className="h-px min-w-3 flex-1 bg-current opacity-25"
      />
      <IconChevronDown
        aria-hidden="true"
        className={`size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
  return (
    <section
      aria-label={name}
      className={cn("flex min-h-0 flex-col", filled ? "flex-1" : "shrink")}
    >
      <div className="mx-1 shrink-0">
        {headerMenu === undefined ? (
          header
        ) : (
          <ContextMenu>
            <ContextMenuTrigger render={header} />
            <ContextMenuContent className="w-max min-w-40">
              <ActionMenuItems actions={headerMenu} />
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>
      {open ? notice : null}
      <div
        ref={scrollRef}
        className={cn("min-h-0 overflow-auto px-1", filled && "flex-1")}
      >
        <div style={{ height: totalSize, position: "relative" }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const element = (
              <div
                key={row.key}
                className={cn(
                  "group absolute inset-x-0 flex items-center gap-2 rounded-md pr-1 text-[.85rem] select-none has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-sidebar-ring has-[:focus-visible]:ring-inset",
                  chosen(row)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground",
                )}
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft:
                    (row.file === undefined ? 6 : 10) + row.depth * 18,
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
            const actions = menu?.(row) ?? [];
            return actions.length === 0 ? (
              element
            ) : (
              <ContextMenu
                key={row.key}
                onOpenChange={(open) => {
                  if (open) onMenuOpen?.(row);
                  else onMenuClose?.();
                }}
              >
                <ContextMenuTrigger render={element} />
                <ContextMenuContent className="w-max min-w-48 max-w-md">
                  <ActionMenuItems actions={actions} />
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

export function openMenu(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))
    return;
  event.preventDefault();
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new globalThis.MouseEvent("contextmenu", {
      bubbles: true,
      clientX: bounds.left + 32,
      clientY: bounds.bottom,
    }),
  );
}

export function RowLead<File extends { readonly path: string }>({
  row,
  collapsed,
}: {
  readonly row: ChangeTreeRow<File>;
  readonly collapsed: ReadonlySet<string>;
}) {
  if (row.file !== undefined) return <ChangeFileIcon path={row.key} />;
  const closed = collapsed.has(row.key);
  const Folder = closed ? IconFolder : IconFolderOpen;
  return (
    <>
      <IconChevronDown
        aria-hidden="true"
        className={`size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${closed ? "-rotate-90" : ""}`}
      />
      <Folder aria-hidden="true" className="size-3.5 shrink-0" />
    </>
  );
}
