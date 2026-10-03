import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type {
  RemoteBranch,
  RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  everyAction,
  keyAction,
  runAction,
} from "#web/components/ui/action-menu.tsx";
import {
  BranchCard,
  createBranchCardHandle,
} from "#web/features/branches-sidebar/branch-card.tsx";
import { treeKeyAction } from "#web/features/branches-sidebar/branches-sidebar-keyboard.ts";
import {
  RefRow,
  rowElementId,
  SectionRow,
} from "#web/features/branches-sidebar/branches-sidebar-rows.tsx";
import {
  type BranchesSidebarExpandableRow,
  type BranchesSidebarItem,
  type BranchesSidebarRefRow,
  type BranchesSidebarRow,
  type BranchesSidebarScope,
  branchesSidebarItems,
  buildBranchesSidebarRows,
  currentRefRowId,
  defaultExpandedSections,
  refFolderIds,
  refRowId,
  refSectionId,
  scopeShowing,
  selectRefRows,
  settledSectionId,
  stashesSectionId,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import { DockedTree } from "#web/features/branches-sidebar/docked-tree.tsx";
import { SidebarStatus } from "#web/features/branches-sidebar/sidebar-status.tsx";
import {
  BranchesSidebarFilter,
  BranchesSidebarViewSelector,
  useBranchesSidebarView,
} from "#web/features/branches-sidebar/sidebar-view-controls.tsx";
import { historyRefKey } from "#web/features/commit-graph/scope/history-scope.ts";
import type { MergeActions } from "#web/features/merge/merge-actions.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { PullRequests } from "#web/features/pull-requests/pull-requests.tsx";
import type { RebaseActions } from "#web/features/rebase/rebase-actions.ts";
import {
  type RefActionRow,
  refActions,
  selectedBranchActions,
  selectedTagActions,
  useRefIntent,
} from "#web/features/refs/ref-actions.ts";
import { useRefEditing } from "#web/features/refs/ref-editing.ts";
import { RefEditingStatus } from "#web/features/refs/ref-editing-status.tsx";
import {
  commitStartPoint,
  type RefKind,
} from "#web/features/refs/ref-kinds.ts";
import { RefEditField } from "#web/features/refs/ref-name-field.tsx";
import {
  activeHead,
  useRefActivation,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { TagDetails } from "#web/features/refs/tag-details.tsx";
import { useTagPush } from "#web/features/refs/tag-push.tsx";
import { usePull } from "#web/features/remote-sync/use-pull.ts";
import type { ResetActions } from "#web/features/reset/reset-actions.tsx";
import {
  StashDropConfirmation,
  StashNameField,
  StashRow,
} from "#web/features/stashes/stash-sidebar.tsx";
import {
  useStashCommands,
  useStashDraft,
  useStashes,
} from "#web/features/stashes/stashes.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

const noSelectedRefs: ReadonlySet<string> = new Set();
const noPullRequests: readonly PullRequest[] = [];
const noRemoteBranches: readonly RemoteBranch[] = [];
const noSelectedRows: ReadonlySet<string> = new Set();

export function BranchesSidebar({
  merge,
  pullRequests,
  rebase,
  reset,
  onBranchRenamed = () => undefined,
  onToggleHistoryRef = () => undefined,
  onShowReflog,
  onOpenStash = () => undefined,
  selectedHistoryRefKeys = noSelectedRefs,
}: {
  readonly merge?: MergeActions | undefined;
  readonly pullRequests?: PullRequests | undefined;
  readonly rebase?: RebaseActions | undefined;
  readonly reset?: ResetActions | undefined;
  readonly onBranchRenamed?: (rename: {
    readonly name: string;
    readonly newName: string;
  }) => void;
  readonly onToggleHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly onShowReflog?: (branch: string) => void;
  readonly onOpenStash?: (oid: string) => void;
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
}): JSX.Element {
  const activeWorktreePath = useRepositoryScope()?.worktreePath ?? "";
  const repositoryRefs = useScopedRepositoryRefs();
  const activation = useRefActivation(repositoryRefs);
  const pull = usePull();
  const tagPush = useTagPush();
  const stashes = useStashes();
  const stashCommands = useStashCommands();
  const stashDraft = useStashDraft();
  const settling = useCommand(BranchSettlingApi.settle);
  const errorToast = useErrorToast();
  const settle = (names: readonly string[], settled: boolean) =>
    void settling
      .run({ names, settled })
      .then((result) => errorToast.failure("settleBranches", result));
  const [selectedRows, setSelectedRows] = useState(noSelectedRows);
  const [query, setQuery] = useState("");
  const filterQuery = useDeferredValue(query);
  const [scope, setScope] = useState<BranchesSidebarScope>("all");
  const [expandedSections, setExpandedSections] = useState(
    defaultExpandedSections,
  );
  const [view, setView] = useBranchesSidebarView();
  const [expandedFolders, setExpandedFolders] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());
  const [activeRowId, setActiveRowId] = useState<string>();
  const [branchCard] = useState(createBranchCardHandle);
  const treeRef = useRef<HTMLDivElement>(null);
  const refs = repositoryRefs.refs;
  const onSelectRef = activation.select;
  const folderRepositoryRef = useRef(refs?.repositoryId);
  useEffect(() => {
    if (folderRepositoryRef.current === refs?.repositoryId) return;
    folderRepositoryRef.current = refs?.repositoryId;
    setExpandedFolders(new Map());
  }, [refs?.repositoryId]);
  const rows = useMemo(
    () =>
      refs === undefined
        ? []
        : buildBranchesSidebarRows(
            refs,
            activeWorktreePath,
            expandedSections,
            filterQuery,
            scope,
            { view, folders: expandedFolders },
            { list: stashes, drafting: stashDraft.selection !== undefined },
          ),
    [
      activeWorktreePath,
      expandedSections,
      expandedFolders,
      filterQuery,
      refs,
      scope,
      stashDraft.selection,
      stashes,
      view,
    ],
  );
  const focusTree = useCallback(() => treeRef.current?.focus(), []);
  const reveal = useCallback(
    (kind: RefKind, name: string, settled?: boolean) => {
      const sectionId = settled ? settledSectionId : refSectionId(kind);
      setExpandedSections((current) =>
        current.has(sectionId) ? current : toggleSection(current, sectionId),
      );
      setExpandedFolders((current) => {
        const next = new Map(current);
        for (const id of refFolderIds(sectionId, name)) next.set(id, true);
        return next;
      });
      setActiveRowId(refRowId(sectionId, name));
      treeRef.current?.focus();
    },
    [],
  );
  const editing = useRefEditing({
    refs,
    focusTree,
    reveal,
    onCreated: (name) => onSelectRef({ _tag: "LocalBranch", name }),
    onRenamed: onBranchRenamed,
  });
  const edit = editing.edit;
  const draftSectionId =
    edit?.kind === "create" ? refSectionId(edit.ref) : undefined;
  useEffect(() => {
    if (draftSectionId === undefined) return;
    setScope((current) => scopeShowing(current, draftSectionId));
    setExpandedSections((current) =>
      current.has(draftSectionId)
        ? current
        : toggleSection(current, draftSectionId),
    );
  }, [draftSectionId]);
  useEffect(() => {
    if (stashDraft.selection !== undefined)
      setScope((current) => scopeShowing(current, stashesSectionId));
  }, [stashDraft.selection]);
  const detailsRowId = rows.find(
    (row) =>
      row.id === activeRowId && row.kind === "ref" && row.target._tag === "Tag",
  )?.id;
  const items = useMemo(
    () =>
      branchesSidebarItems(
        rows,
        draftSectionId,
        detailsRowId,
        stashDraft.selection !== undefined,
      ),
    [rows, draftSectionId, detailsRowId, stashDraft.selection],
  );
  const activeIndexRef = useRef(-1);
  useEffect(() => {
    const index = rows.findIndex((row) => row.id === activeRowId);
    if (index >= 0) activeIndexRef.current = index;
    else if (activeRowId !== undefined)
      setActiveRowId(
        rows[Math.min(activeIndexRef.current, rows.length - 1)]?.id,
      );
  }, [activeRowId, rows]);

  useEffect(() => {
    setSelectedRows((current) => {
      if (current.size === 0) return current;
      const shown = new Set(rows.map((row) => row.id));
      const kept = [...current].filter((id) => shown.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [rows]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useRefIntent((intent) => {
    if (intent._tag === "DraftRef") {
      editing.draft(intent.kind, commitStartPoint(intent.oid));
      return;
    }
    if (intent._tag === "RunRefAction") {
      const key = historyRefKey(intent.target);
      const row = rowsRef.current.find(
        (candidate) =>
          candidate.kind === "ref" && historyRefKey(candidate.target) === key,
      );
      runAction(
        everyAction(
          refActionsFor(
            row?.kind === "ref"
              ? row
              : { id: key, name: intent.target.name, target: intent.target },
          ),
        ).find((action) => action.id === intent.id),
      );
      return;
    }
    treeRef.current?.focus();
    setActiveRowId(
      (current) =>
        current ?? currentRefRowId(rowsRef.current) ?? rowsRef.current[0]?.id,
    );
  });

  const refActionsFor = (row: RefActionRow) =>
    refs === undefined
      ? []
      : refActions(
          row,
          refs,
          { activeWorktreePath, writable: editing.writable },
          {
            checkout: onSelectRef,
            merge: merge?.actionFor,
            rebase: rebase?.actionFor,
            reset: reset?.actionFor,
            showReflog: onShowReflog,
            pullRequests: pullRequests?.actionFor,
            pull: pull.allowed
              ? {
                  pulling: pull.pulling,
                  run: (branch) => void pull.pull(branch),
                }
              : undefined,
            pushTags: tagPush,
            settle,
            editing,
          },
        );

  const selection = rows.filter(
    (row): row is BranchesSidebarRefRow =>
      row.kind === "ref" && selectedRows.has(row.id),
  );
  const selectedNames = selection.map(({ name }) => name);
  const selectionActions =
    refs === undefined || selection.length < 2
      ? undefined
      : selection[0]?.target._tag === "Tag"
        ? selectedTagActions(
            selectedNames,
            refs,
            { writable: editing.writable },
            tagPush,
          )
        : selectedBranchActions(
            selectedNames,
            refs,
            { writable: editing.writable },
            { editing, settle },
          );
  const actionsFor = (row: BranchesSidebarRefRow) =>
    selectionActions !== undefined && selectedRows.has(row.id)
      ? selectionActions
      : refActionsFor(row);

  const moveActive = (rowId: string | undefined) => {
    setSelectedRows(noSelectedRows);
    setActiveRowId(rowId);
  };

  const setRowExpanded = (
    row: BranchesSidebarExpandableRow,
    expanded: boolean,
  ) => {
    if (row.kind === "folder") {
      setExpandedFolders((current) => new Map(current).set(row.id, expanded));
    } else {
      setExpandedSections((current) =>
        current.has(row.sectionId) === expanded
          ? current
          : toggleSection(current, row.sectionId),
      );
    }
  };

  const activateRow = (row: BranchesSidebarRow) => {
    if (row.kind === "ref") onSelectRef(row.target);
    else if (row.kind === "stash") onOpenStash(row.stash.oid);
    else setRowExpanded(row, !row.expanded);
  };

  const openRowMenu = (rowId: string) => {
    const row = document.getElementById(rowElementId(rowId));
    if (row === null) return;
    const bounds = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: bounds.left + 32,
        clientY: bounds.bottom,
      }),
    );
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const activeRow = rows.find((row) => row.id === activeRowId);
    if (
      (activeRow?.kind === "ref" || activeRow?.kind === "stash") &&
      (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
    ) {
      event.preventDefault();
      openRowMenu(activeRow.id);
      return;
    }
    if (
      activeRow?.kind === "stash" &&
      runAction(keyAction(stashCommands.actionsFor(activeRow.stash), event.key))
    ) {
      event.preventDefault();
      return;
    }
    if (
      activeRow?.kind === "ref" &&
      runAction(keyAction(actionsFor(activeRow), event.key))
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && selectedRows.size > 0) {
      event.preventDefault();
      setSelectedRows(noSelectedRows);
      return;
    }
    const handled = treeKeyAction(event.key, {
      activeRow,
      collapse: (row) => setRowExpanded(row, false),
      expand: (row) => setRowExpanded(row, true),
      hasQuery: query.length > 0,
      rows,
      setActive: moveActive,
      toggleHistoryRef: (row) => onToggleHistoryRef(row.target),
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

  const renderItem = (item: BranchesSidebarItem) => {
    if (item.kind === "stash-draft")
      return stashDraft.selection === undefined ? null : (
        <StashNameField
          commands={stashCommands}
          initialName={`WIP on ${
            (refs === undefined
              ? undefined
              : activeHead(refs, activeWorktreePath)?.branch) ?? "(no branch)"
          }`}
          onDone={() => {
            stashDraft.cancel();
            focusTree();
          }}
          selection={stashDraft.selection}
        />
      );
    if (
      item.kind === "draft" ||
      (edit?.kind === "rename" && edit.rowId === item.id)
    )
      return (
        <RefEditField
          editing={editing}
          level={item.kind === "row" ? item.row.level : 2}
          refs={refs}
        />
      );
    if (item.kind === "details") {
      const tag = refs?.tags.find(({ name }) => name === item.row.name);
      return tag === undefined ? null : (
        <TagDetails level={item.row.level} tag={tag} />
      );
    }
    if (item.kind !== "row") return null;
    const row = item.row;
    if (row.kind === "stash")
      return (
        <StashRow
          actions={stashCommands.actionsFor(row.stash)}
          active={row.id === activeRowId}
          elementId={rowElementId(row.id)}
          key={row.id}
          onActivate={() => setActiveRowId(row.id)}
          onOpen={() => onOpenStash(row.stash.oid)}
          position={row.position}
          setSize={row.setSize}
          stash={row.stash}
        />
      );
    if (row.kind !== "ref")
      return (
        <SectionRow
          active={row.id === activeRowId}
          key={row.id}
          onActivate={() => setActiveRowId(row.id)}
          onToggle={() => activateRow(row)}
          row={row}
        />
      );
    return (
      <RefRow
        actions={actionsFor(row)}
        active={row.id === activeRowId}
        card={row.target._tag === "LocalBranch" ? branchCard : undefined}
        key={row.id}
        onActivate={(mode) => {
          const next = selectRefRows(
            rows,
            selectedRows,
            activeRowId,
            row.id,
            mode,
          );
          setSelectedRows(next);
          setActiveRowId(
            next.size === 0 || next.has(row.id) ? row.id : [...next].at(-1),
          );
          merge?.inspect(row.target);
          rebase?.inspect(row.target);
        }}
        onToggleHistory={() => onToggleHistoryRef(row.target)}
        pullRequests={
          row.target._tag === "LocalBranch" && pullRequests !== undefined
            ? pullRequests.forBranch(row.name)
            : noPullRequests
        }
        row={row}
        selected={selectedRows.has(row.id)}
        selectedInHistory={selectedHistoryRefKeys.has(
          historyRefKey(row.target),
        )}
      />
    );
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
        <BranchesSidebarViewSelector view={view} onChange={setView} />
      </div>
      <BranchesSidebarFilter
        onKeyDown={handleFilterKeyDown}
        onQueryChange={setQuery}
        onScopeChange={setScope}
        query={query}
        scope={scope}
      />
      <DockedTree
        activeRowId={activeRowId}
        busy={activation.checkingOut}
        items={items}
        onKeyDown={handleTreeKeyDown}
        renderItem={renderItem}
        treeRef={treeRef}
      >
        <SidebarStatus
          query={query}
          repositoryRefs={repositoryRefs}
          rows={rows}
          scope={scope}
        />
      </DockedTree>
      <BranchCard
        handle={branchCard}
        remoteBranches={refs?.remoteBranches ?? noRemoteBranches}
      />
      <RefEditingStatus editing={editing} />
      <StashDropConfirmation commands={stashCommands} />
    </nav>
  );
}
