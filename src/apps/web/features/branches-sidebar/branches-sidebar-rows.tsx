import type { BranchUpstream } from "@rebase/contracts";
import {
  IconChevronDown,
  IconCloud,
  IconEye,
  IconEyePlus,
  IconFolderCode,
  IconGitBranch,
  IconTag,
} from "@tabler/icons-react";
import type { CSSProperties, JSX } from "react";
import type {
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
  ContextMenuTrigger,
} from "#web-ui/components/ui/context-menu";

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
  readonly row: BranchesSidebarSectionRow;
  readonly style: CSSProperties;
}): JSX.Element {
  const Icon =
    row.sectionId === localBranchesSectionId
      ? IconGitBranch
      : row.sectionId === tagsSectionId
        ? IconTag
        : IconCloud;
  return (
    <button
      aria-expanded={row.expanded}
      aria-label={`${row.title}, ${row.count}${row.truncated ? "+" : ""}`}
      aria-level={1}
      className={`absolute top-0 left-0 flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 text-left text-[.72rem] font-semibold tracking-wide text-muted-foreground uppercase outline-none select-none hover:text-sidebar-accent-foreground ${active ? "ring-1 ring-sidebar-ring/60 ring-inset" : ""}`}
      id={rowElementId(row.id)}
      onClick={() => {
        onActivate();
        onToggle();
      }}
      role="treeitem"
      style={style}
      tabIndex={-1}
      type="button"
    >
      <IconChevronDown
        aria-hidden="true"
        className={`size-3.5 shrink-0 transition-transform ${row.expanded ? "" : "-rotate-90"}`}
      />
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      <span className="font-mono text-[.69rem] font-normal">
        {row.count}
        {row.truncated ? "+" : ""}
      </span>
    </button>
  );
}

export function RefRow({
  active,
  onActivate,
  onSelect,
  onToggleHistory,
  row,
  selectedInHistory,
  style,
}: {
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onSelect: () => void;
  readonly onToggleHistory: () => void;
  readonly row: BranchesSidebarRefRow;
  readonly selectedInHistory: boolean;
  readonly style: CSSProperties;
}): JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={`group absolute top-0 left-0 flex w-full cursor-default items-center rounded-md text-[.85rem] outline-none select-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground ${row.current ? "font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground"} ${active ? "bg-sidebar-accent ring-1 ring-sidebar-ring/60 ring-inset" : ""}`}
            style={style}
          >
            <button
              aria-level={2}
              aria-label={refRowLabel(row)}
              aria-current={row.current ? "true" : undefined}
              aria-selected={active}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-2.5 text-left outline-none"
              id={rowElementId(row.id)}
              onClick={onActivate}
              onContextMenu={onActivate}
              onDoubleClick={onSelect}
              role="treeitem"
              tabIndex={-1}
              type="button"
            >
              <RefIcon row={row} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              {row.checkout?.kind !== "worktree" ? null : (
                <IconFolderCode
                  aria-label="Linked worktree"
                  role="img"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              )}
              {row.upstream === undefined ? null : (
                <UpstreamIndicator upstream={row.upstream} />
              )}
            </button>
            <HistorySelectionButton
              onToggle={onToggleHistory}
              row={row}
              selected={selectedInHistory}
            />
          </div>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onClick={onSelect}>Checkout</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HistorySelectionButton({
  onToggle,
  row,
  selected,
}: {
  readonly onToggle: () => void;
  readonly row: BranchesSidebarRefRow;
  readonly selected: boolean;
}) {
  const Icon = selected ? IconEye : IconEyePlus;
  return (
    <button
      aria-label={`${selected ? "Remove" : "Add"} ${row.name} ${
        selected ? "from" : "to"
      } history`}
      className={`grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"}`}
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

function UpstreamIndicator({
  upstream,
}: {
  readonly upstream: BranchUpstream;
}): JSX.Element | null {
  if (upstream.gone) {
    return (
      <span className="shrink-0 font-mono text-[.69rem] text-status-unavailable">
        gone
      </span>
    );
  }
  if (upstream.ahead === 0 && upstream.behind === 0) return null;
  return (
    <span className="flex shrink-0 gap-1 font-mono text-[.69rem]">
      {upstream.ahead > 0 ? (
        <span className="text-status-available">↑{upstream.ahead}</span>
      ) : null}
      {upstream.behind > 0 ? (
        <span className="text-status-connecting">↓{upstream.behind}</span>
      ) : null}
    </span>
  );
}
