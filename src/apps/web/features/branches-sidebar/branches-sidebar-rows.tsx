import {
  IconChevronDown,
  IconCloud,
  IconEye,
  IconEyePlus,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconGitBranchDeleted,
  IconStack2,
  IconTag,
} from "@tabler/icons-react";
import { type JSX, useRef } from "react";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { BranchUpstream } from "#contracts/repository-refs/repository-refs.contract.ts";
import { ActionMenuItems, runAction } from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import {
  type BranchCardHandle,
  BranchCardTrigger,
  branchCardTriggerId,
} from "#web/features/branches-sidebar/branch-card.tsx";
import type { BranchesSidebarFolderRow } from "#web/features/branches-sidebar/branch-tree.ts";
import type {
  BranchesSidebarRefRow,
  BranchesSidebarSectionRow,
  RefSelectionMode,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import {
  describePullRequest,
  PullRequestLink,
} from "#web/features/pull-requests/pull-requests.tsx";
import type { RefAction } from "#web/features/refs/ref-actions.ts";
import { compactCount } from "#web/lib/compact-count.ts";

export function rowElementId(rowId: string): string {
  return `branches-row-${rowId}`;
}

const sectionLooks = {
  local: {
    Icon: IconGitBranch,
    className: "text-primary",
  },
  settled: {
    Icon: IconGitBranchDeleted,
    className: "text-muted-foreground",
  },
  remote: { Icon: IconCloud, className: "text-info" },
  tags: { Icon: IconTag, className: "text-warning" },
  stashes: {
    Icon: IconStack2,
    className: "text-special",
  },
} as const;

export function SectionRow({
  active,
  onActivate,
  onToggle,
  row,
}: {
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onToggle: () => void;
  readonly row: BranchesSidebarSectionRow | BranchesSidebarFolderRow;
}) {
  const folder = row.kind === "folder";
  const look = folder ? undefined : sectionLooks[row.scope];
  const Icon = look?.Icon ?? (row.expanded ? IconFolderOpen : IconFolder);
  return (
    <button
      aria-expanded={row.expanded}
      aria-label={
        folder
          ? row.path
          : `${row.title} (${row.count}${row.truncated ? "+" : ""})`
      }
      aria-level={row.level}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      className={`relative flex h-8 w-full cursor-default items-center rounded-control text-left outline-none select-none ${folder ? "gap-1.5 text-body text-sidebar-foreground hover:text-sidebar-accent-foreground" : `gap-2 px-1.5 text-body hover:bg-sidebar-accent/50 ${look?.className ?? ""}`} ${active ? "bg-sidebar-accent/75" : ""}`}
      id={rowElementId(row.id)}
      onClick={() => {
        onActivate();
        onToggle();
      }}
      role="treeitem"
      style={
        folder
          ? { paddingLeft: 6 + Math.max(0, row.level - 2) * 18 }
          : undefined
      }
      tabIndex={-1}
      type="button"
    >
      {folder ? (
        <>
          <IconChevronDown
            aria-hidden="true"
            className={`size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${row.expanded ? "" : "-rotate-90"}`}
          />
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{row.label}/</span>
        </>
      ) : (
        <>
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate first-letter:uppercase">
            {row.title} ({row.count}
            {row.truncated ? "+" : ""})
          </span>
          <span
            aria-hidden="true"
            className="h-px min-w-3 flex-1 bg-current opacity-40"
          />
          <IconChevronDown
            aria-hidden="true"
            className={`size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none ${row.expanded ? "rotate-180" : ""}`}
          />
        </>
      )}
    </button>
  );
}

export function RefRow({
  actions,
  active,
  card,
  selected,
  onActivate,
  onToggleHistory,
  pullRequests,
  row,
  selectedInHistory,
}: {
  readonly actions: readonly RefAction[];
  readonly active: boolean;
  readonly card: BranchCardHandle | undefined;
  readonly selected: boolean;
  readonly onActivate: (mode: RefSelectionMode) => void;
  readonly onToggleHistory: () => void;
  readonly pullRequests: readonly PullRequest[];
  readonly row: BranchesSidebarRefRow;
  readonly selectedInHistory: boolean;
}) {
  const acted = useRef(false);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) acted.current = false;
      }}
    >
      <ContextMenuTrigger
        render={withCard(
          card,
          row,
          <div
            className={`group relative flex h-8 w-full cursor-default items-center rounded-control text-body outline-none select-none hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground ${row.current ? "font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground"} ${active || selected ? "bg-sidebar-accent" : ""}`}
          >
            <button
              aria-level={row.level}
              aria-posinset={row.position}
              aria-setsize={row.setSize}
              aria-label={refRowLabel(row, pullRequests)}
              aria-current={row.current ? "true" : undefined}
              aria-selected={active || selected}
              className="relative flex h-full min-w-0 flex-1 items-center gap-2 rounded-control pr-1.5 text-left outline-none"
              style={{ paddingLeft: 10 + (row.level - 2) * 18 }}
              id={rowElementId(row.id)}
              onClick={(event) => {
                onActivate(
                  event.shiftKey
                    ? "range"
                    : event.ctrlKey || event.metaKey
                      ? "toggle"
                      : "replace",
                );
              }}
              onContextMenu={() => onActivate("keep")}
              onDoubleClick={() =>
                runAction(actions.find(({ id }) => id === "checkout"))
              }
              role="treeitem"
              tabIndex={-1}
              type="button"
            >
              {row.current ? (
                <span
                  aria-hidden="true"
                  className="absolute size-1.5 rounded-full bg-primary"
                  style={{ left: 1 + (row.level - 2) * 18 }}
                />
              ) : null}
              <span className="min-w-0 truncate">{row.label}</span>
              {row.upstream === undefined ? null : (
                <SyncCounts upstream={row.upstream} />
              )}
            </button>
            <PullRequestLink pullRequests={pullRequests} />
            <HistorySelectionButton
              active={active}
              onToggle={onToggleHistory}
              row={row}
              selected={selectedInHistory}
            />
          </div>,
        )}
      />
      <ContextMenuContent
        className="w-max min-w-64 max-w-md"
        finalFocus={() => !acted.current}
      >
        <ActionMenuItems
          actions={actions}
          onRun={(action) => {
            acted.current =
              action.group !== undefined || action.takesFocus === true;
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function withCard(
  card: BranchCardHandle | undefined,
  ref: BranchesSidebarRefRow,
  row: JSX.Element,
): JSX.Element {
  return card === undefined ? (
    row
  ) : (
    <BranchCardTrigger
      handle={card}
      id={branchCardTriggerId(ref.id)}
      payload={{ row: ref }}
      render={row}
    />
  );
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
      className={`grid size-6 shrink-0 place-items-center rounded-control text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring ${selected ? "opacity-100" : `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${active ? "group-focus/tree:opacity-100" : ""}`}`}
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

function refRowLabel(
  row: BranchesSidebarRefRow,
  pullRequests: readonly PullRequest[],
): string {
  const [newest] = pullRequests;
  return [
    row.name,
    ...(row.current ? ["current branch"] : []),
    ...(row.checkout?.kind === "worktree" ? ["linked worktree"] : []),
    ...(row.upstream?.gone ? ["remote branch deleted"] : []),
    ...(newest === undefined ? [] : [describePullRequest(newest)]),
    ...(pullRequests.length > 1 ? [`${pullRequests.length - 1} more`] : []),
  ].join(", ");
}

function SyncCounts({ upstream }: { readonly upstream: BranchUpstream }) {
  if (upstream.gone || (upstream.ahead === 0 && upstream.behind === 0))
    return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-meta font-normal tabular-nums">
      {upstream.ahead > 0 ? (
        <span
          aria-label={`${upstream.ahead} commits to push`}
          className="text-success"
          role="img"
        >
          {compactCount(upstream.ahead)}↑
        </span>
      ) : null}
      {upstream.behind > 0 ? (
        <span
          aria-label={`${upstream.behind} commits to pull`}
          className="text-destructive"
          role="img"
        >
          {compactCount(upstream.behind)}↓
        </span>
      ) : null}
    </span>
  );
}
