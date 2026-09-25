import {
  IconChevronDown,
  IconCloud,
  IconEye,
  IconEyePlus,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconTag,
} from "@tabler/icons-react";
import { type CSSProperties, Fragment, useRef } from "react";
import type {
  BranchRowAction,
  BranchRowActionId,
} from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import type {
  BranchesSidebarFolderRow,
  BranchesSidebarRefRow,
  BranchesSidebarSectionRow,
} from "#web/features/branches-sidebar/branches-sidebar.contract";
import {
  localBranchesSectionId,
  tagsSectionId,
} from "#web/features/branches-sidebar/branches-sidebar.contract";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "#web-ui/components/ui/context-menu";
import { UpstreamIndicator } from "#web-ui/features/branches-sidebar/components/upstream-indicator";

export function rowElementId(rowId: string): string {
  return `branches-row-${rowId}`;
}

export function SectionRow({
  active,
  onActivate,
  onToggle,
  row,
  style,
}: {
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onToggle: () => void;
  readonly row: BranchesSidebarSectionRow | BranchesSidebarFolderRow;
  readonly style: CSSProperties;
}) {
  const folder = row.kind === "folder";
  const Icon = folder
    ? row.expanded
      ? IconFolderOpen
      : IconFolder
    : row.sectionId === localBranchesSectionId
      ? IconGitBranch
      : row.sectionId === tagsSectionId
        ? IconTag
        : IconCloud;
  return (
    <button
      aria-expanded={row.expanded}
      aria-label={
        folder
          ? row.path
          : row.truncated
            ? `${row.title}, partial list`
            : row.title
      }
      aria-level={row.level}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      className={`absolute top-0 left-0 flex w-full cursor-default items-center gap-1.5 rounded-md text-left text-sidebar-foreground outline-none select-none hover:text-sidebar-accent-foreground ${folder ? "text-[.81rem]" : "text-[.72rem] font-semibold tracking-wide uppercase"} ${!folder && row.separator ? "pt-3 before:absolute before:inset-x-0 before:top-0 before:border-t before:border-sidebar-border" : ""} ${active ? "ring-1 ring-sidebar-ring/60 ring-inset" : ""}`}
      id={rowElementId(row.id)}
      onClick={() => {
        onActivate();
        onToggle();
      }}
      role="treeitem"
      style={{ ...style, paddingLeft: 6 + Math.max(0, row.level - 2) * 18 }}
      tabIndex={-1}
      type="button"
    >
      <TreeGuides level={row.level} />
      <IconChevronDown
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${row.expanded ? "" : "-rotate-90"}`}
      />
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {folder ? `${row.label}/` : row.title}
      </span>
    </button>
  );
}

export function RefRow({
  actions,
  active,
  onAction,
  onActivate,
  onPull,
  onSelect,
  onToggleHistory,
  pulling,
  row,
  selectedInHistory,
  style,
}: {
  readonly actions: readonly BranchRowAction[];
  readonly onAction: (id: BranchRowActionId) => void;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onPull: (() => void) | undefined;
  readonly onSelect: () => void;
  readonly onToggleHistory: () => void;
  readonly pulling: boolean;
  readonly row: BranchesSidebarRefRow;
  readonly selectedInHistory: boolean;
  readonly style: CSSProperties;
}) {
  const acted = useRef(false);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) acted.current = false;
      }}
    >
      <ContextMenuTrigger
        render={
          <div
            className={`group absolute top-0 left-0 flex w-full cursor-default items-center rounded-md text-[.85rem] outline-none select-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground ${row.current ? "font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground"} ${active ? "bg-sidebar-accent ring-1 ring-sidebar-ring/60 ring-inset" : ""}`}
            style={style}
          >
            <TreeGuides level={row.level} />
            <button
              aria-level={row.level}
              aria-posinset={row.position}
              aria-setsize={row.setSize}
              aria-label={refRowLabel(row)}
              aria-current={row.current ? "true" : undefined}
              aria-selected={active}
              className="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-8 text-left outline-none"
              style={{ paddingLeft: 10 + (row.level - 2) * 18 }}
              id={rowElementId(row.id)}
              onClick={(event) => {
                onActivate();
                if (
                  event.target instanceof Element &&
                  event.target.closest("[data-upstream-indicator]") !== null
                )
                  onAction("upstream");
              }}
              onContextMenu={onActivate}
              onDoubleClick={onSelect}
              role="treeitem"
              tabIndex={-1}
              type="button"
            >
              <RefIcon row={row} />
              <span className="min-w-0 truncate">{row.label}</span>
              {row.upstream === undefined ? null : (
                <UpstreamIndicator upstream={row.upstream} />
              )}
              {row.checkout?.kind !== "worktree" ? null : (
                <svg
                  aria-label="Linked worktree"
                  role="img"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute right-2 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${active ? "group-focus/tree:opacity-100" : ""}`}
                >
                  <path d="M10 19H3V5h6l2 3h10v3" />
                  <circle cx="15" cy="14" r="1.5" />
                  <circle cx="21" cy="17" r="1.5" />
                  <circle cx="15" cy="21" r="1.5" />
                  <path d="M15 15.5v4M15 18h3a3 3 0 0 0 2-1" />
                </svg>
              )}
            </button>
            <HistorySelectionButton
              active={active}
              onToggle={onToggleHistory}
              row={row}
              selected={selectedInHistory}
            />
          </div>
        }
      />
      <ContextMenuContent className="w-64" finalFocus={() => !acted.current}>
        <ContextMenuItem onClick={onSelect}>Checkout</ContextMenuItem>
        {onPull === undefined ||
        row.target._tag !== "LocalBranch" ||
        row.upstream === undefined ? null : (
          <ContextMenuItem disabled={pulling} onClick={onPull}>
            Pull
          </ContextMenuItem>
        )}
        {actions.map((action, index) => (
          <Fragment key={action.id}>
            {action.group !== (actions[index - 1]?.group ?? "create") ? (
              <ContextMenuSeparator />
            ) : null}
            <ContextMenuItem
              disabled={action.disabledReason !== undefined}
              onClick={() => {
                acted.current = true;
                onAction(action.id);
              }}
            >
              <span className="flex-1">{action.label}</span>
              <span className="text-[.7rem] text-muted-foreground">
                {action.disabledReason ?? action.shortcut}
              </span>
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TreeGuides({ level }: { readonly level: number }) {
  return Array.from(
    { length: Math.max(0, level - 2) },
    (_, index) => 15 + index * 18,
  ).map((left) => (
    <span
      key={left}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 border-sidebar-border border-l"
      style={{ left }}
    />
  ));
}

function HistorySelectionButton({
  active,
  onToggle,
  row,
  selected,
}: {
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly row: BranchesSidebarRefRow;
  readonly selected: boolean;
}) {
  const Icon = selected ? IconEye : IconEyePlus;
  return (
    <button
      aria-label={`${selected ? "Remove" : "Add"} ${row.name} ${selected ? "from" : "to"} history`}
      className={`grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring ${selected ? "opacity-100" : `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${active ? "group-focus/tree:opacity-100" : ""}`}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      tabIndex={-1}
      type="button"
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  );
}

function RefIcon({ row }: { readonly row: BranchesSidebarRefRow }) {
  if (row.current)
    return (
      <span
        aria-hidden="true"
        className="flex size-3.5 shrink-0 items-center justify-center"
      >
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
    );
  const Icon = row.target._tag === "Tag" ? IconTag : IconGitBranch;
  return (
    <Icon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}

function refRowLabel(row: BranchesSidebarRefRow): string {
  return [
    row.name,
    ...(row.current ? ["current branch"] : []),
    ...(row.checkout?.kind === "worktree" ? ["linked worktree"] : []),
  ].join(", ");
}
