import type { BranchUpstream } from "@rebase/contracts";
import {
  IconChevronDown,
  IconCloud,
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
  row,
  style,
}: {
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onSelect: () => void;
  readonly row: BranchesSidebarRefRow;
  readonly style: CSSProperties;
}): JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            aria-level={2}
            aria-selected={row.current}
            className={`absolute top-0 left-0 flex w-full cursor-default items-center gap-2 rounded-md pr-2 pl-2.5 text-left text-[.85rem] outline-none select-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground ${row.current ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground"} ${active ? "ring-1 ring-sidebar-ring/60 ring-inset" : ""}`}
            id={rowElementId(row.id)}
            onClick={onActivate}
            onContextMenu={onActivate}
            onDoubleClick={onSelect}
            role="treeitem"
            style={style}
            tabIndex={-1}
            type="button"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${row.current ? "bg-primary" : row.worktreePath === undefined ? "bg-transparent" : "bg-status-available"}`}
            />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            {row.upstream === undefined ? null : (
              <UpstreamIndicator upstream={row.upstream} />
            )}
          </button>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onClick={onSelect}>Checkout</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
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
