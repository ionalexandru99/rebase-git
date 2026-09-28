import type {
  BranchUpstream,
  RemoteBranch,
  RepositoryRefs,
  RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type BranchesSidebarFolderRow,
  buildBranchTree,
  type RowHierarchy,
} from "#web/features/branches-sidebar/branch-tree.ts";
import type { RefKind } from "#web/features/refs/ref-kinds.ts";
import { activeHead } from "#web/features/refs/repository-refs.ts";

export const localBranchesSectionId = "branches";
export const tagsSectionId = "tags";

export type BranchesSidebarScope = "all" | "local" | "remote" | "tags";
export type BranchesSidebarView = "linear" | "tree";

export interface BranchesSidebarTreeOptions {
  readonly view: BranchesSidebarView;
  readonly folders: ReadonlyMap<string, boolean>;
}

export interface BranchesSidebarSectionRow extends RowHierarchy {
  readonly expanded: boolean;
  readonly id: string;
  readonly kind: "section";
  readonly sectionId: string;
  readonly title: string;
  readonly truncated: boolean;
  readonly separator: boolean;
}

export interface BranchesSidebarRefRow extends RowHierarchy {
  readonly current: boolean;
  readonly id: string;
  readonly kind: "ref";
  readonly name: string;
  readonly label: string;
  readonly parentId: string;
  readonly sectionId: string;
  readonly target: RepositoryRefTarget;
  readonly upstream?: BranchUpstream;
  readonly checkout?: {
    readonly kind: "repository" | "worktree";
    readonly path: string;
  };
}

export type BranchesSidebarRow =
  | BranchesSidebarRefRow
  | BranchesSidebarFolderRow
  | BranchesSidebarSectionRow;

export type BranchesSidebarItem =
  | {
      readonly id: string;
      readonly kind: "row";
      readonly row: BranchesSidebarRow;
    }
  | { readonly id: "ref-draft"; readonly kind: "draft" }
  | {
      readonly id: "tag-details";
      readonly kind: "details";
      readonly row: BranchesSidebarRefRow;
    };

export type TagSelectionMode = "replace" | "toggle" | "range" | "keep";

const kindSections: Record<RefKind, string> = {
  branch: localBranchesSectionId,
  tag: tagsSectionId,
};

export const defaultExpandedSections: ReadonlySet<string> = new Set([
  localBranchesSectionId,
]);

export function remoteSectionId(remote: string): string {
  return `remote:${remote}`;
}

export function buildBranchesSidebarRows(
  refs: RepositoryRefs,
  activeWorktreePath: string,
  expandedSections: ReadonlySet<string>,
  query: string,
  scope: BranchesSidebarScope = "all",
  tree?: BranchesSidebarTreeOptions,
): readonly BranchesSidebarRow[] {
  const matches = createMatcher(query);
  const filtering = query.trim().length > 0 || scope !== "all";
  const currentBranch = activeHead(refs, activeWorktreePath)?.branch;
  const mainPath = refs.worktrees.find((worktree) => worktree.main)?.path;
  const sections: readonly SectionDraft[] = [
    {
      refs: refs.branches
        .toSorted(
          (left, right) =>
            branchPriority(left.name, left.worktreePath, currentBranch) -
            branchPriority(right.name, right.worktreePath, currentBranch),
        )
        .filter((branch) => matches(branch.name))
        .map((branch) => ({
          current: branch.name === currentBranch,
          name: branch.name,
          target: { _tag: "LocalBranch", name: branch.name },
          ...(branch.upstream === undefined
            ? {}
            : { upstream: branch.upstream }),
          ...(branch.worktreePath === undefined
            ? {}
            : {
                checkout: {
                  kind:
                    branch.worktreePath === mainPath
                      ? ("repository" as const)
                      : ("worktree" as const),
                  path: branch.worktreePath,
                },
              }),
        })),
      sectionId: localBranchesSectionId,
      scope: "local",
      title: "Local",
      truncated: refs.truncated.branches,
    },
    ...groupByRemote(refs.remoteBranches).map(([remote, branches]) => ({
      refs: branches
        .filter((branch) => matches(branch.name))
        .map((branch) => ({
          current: false,
          name: branch.name,
          target: { _tag: "RemoteBranch", name: branch.name, remote } as const,
        })),
      sectionId: remoteSectionId(remote),
      scope: "remote" as const,
      title: remote,
      truncated: refs.truncated.remoteBranches,
    })),
    {
      refs: refs.tags
        .filter((tag) => matches(tag.name))
        .map((tag) => ({
          current: false,
          name: tag.name,
          target: { _tag: "Tag", name: tag.name } as const,
        })),
      sectionId: tagsSectionId,
      scope: "tags",
      title: "Tags",
      truncated: refs.truncated.tags,
    },
  ];

  const visibleSections = sections
    .filter(sectionMatchesScope(scope))
    .filter((section) => !filtering || section.refs.length > 0)
    .filter(
      (section) =>
        section.scope !== "tags" ||
        section.refs.length > 0 ||
        section.truncated,
    );
  let previousExpanded = false;
  return visibleSections.flatMap((section, index) => {
    const expanded = filtering || expandedSections.has(section.sectionId);
    const header: BranchesSidebarSectionRow = {
      level: 1,
      position: index + 1,
      setSize: visibleSections.length,
      separator: previousExpanded,
      expanded,
      id: `section:${section.sectionId}`,
      kind: "section",
      sectionId: section.sectionId,
      title: section.title,
      truncated: section.truncated,
    };
    previousExpanded = expanded;
    if (!expanded) return [header];
    const refRows = section.refs.map(
      (ref, position): BranchesSidebarRefRow => ({
        ...ref,
        id: refRowId(section.sectionId, ref.name),
        kind: "ref",
        sectionId: section.sectionId,
        label: ref.name,
        level: 2,
        parentId: header.id,
        position: position + 1,
        setSize: section.refs.length,
      }),
    );
    return [
      header,
      ...(tree?.view === "tree"
        ? buildBranchTree(refRows, tree.folders, query.trim().length > 0)
        : refRows),
    ];
  });
}

export function refSectionId(kind: RefKind) {
  return kindSections[kind];
}

export function branchesSidebarItems(
  rows: readonly BranchesSidebarRow[],
  draftSectionId: string | undefined,
  detailsRowId?: string,
): readonly BranchesSidebarItem[] {
  const items: BranchesSidebarItem[] = rows.flatMap(
    (row): BranchesSidebarItem[] =>
      row.id === detailsRowId && row.kind === "ref"
        ? [
            { id: row.id, kind: "row", row },
            { id: "tag-details", kind: "details", row },
          ]
        : [{ id: row.id, kind: "row", row }],
  );
  if (draftSectionId !== undefined)
    items.splice(draftPosition(rows, draftSectionId), 0, {
      id: "ref-draft",
      kind: "draft",
    });
  return items;
}

export function estimateItemHeight(item: BranchesSidebarItem | undefined) {
  if (item?.kind === "draft") return 40;
  if (item?.kind === "details") return 56;
  return item?.row.kind === "section" && item.row.separator ? 44 : 32;
}

export function selectTagRows(
  rows: readonly BranchesSidebarRow[],
  selected: ReadonlySet<string>,
  anchorId: string | undefined,
  rowId: string,
  mode: TagSelectionMode,
): ReadonlySet<string> {
  const isTag = (id: string | undefined) =>
    rows.some(
      (row) => row.id === id && row.kind === "ref" && row.target._tag === "Tag",
    );
  if (!isTag(rowId) || mode === "replace") return new Set();
  if (mode === "keep") return selected.has(rowId) ? selected : new Set();
  if (mode === "toggle") {
    const next = new Set(
      selected.size === 0 && isTag(anchorId) && anchorId !== undefined
        ? [anchorId]
        : selected,
    );
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    return next;
  }
  const from = rows.findIndex((row) => row.id === anchorId);
  const to = rows.findIndex((row) => row.id === rowId);
  if (from < 0 || !isTag(anchorId)) return new Set([rowId]);
  return new Set(
    rows
      .slice(Math.min(from, to), Math.max(from, to) + 1)
      .filter((row) => isTag(row.id))
      .map((row) => row.id),
  );
}

export function refRowId(sectionId: string, name: string) {
  return `ref:${sectionId}:${name}`;
}

export function refFolderIds(
  sectionId: string,
  name: string,
): readonly string[] {
  const parts = name.split("/").slice(0, -1);
  return parts.map(
    (_, index) => `folder:${sectionId}:${parts.slice(0, index + 1).join("/")}`,
  );
}

export function scopeShowing(
  scope: BranchesSidebarScope,
  sectionId: string,
): BranchesSidebarScope {
  const sectionScope =
    sectionId === localBranchesSectionId
      ? "local"
      : sectionId === tagsSectionId
        ? "tags"
        : "remote";
  return scope === "all" || scope === sectionScope ? scope : sectionScope;
}

function sectionMatchesScope(scope: BranchesSidebarScope) {
  return (section: SectionDraft) => scope === "all" || section.scope === scope;
}

export function toggleSection(
  expandedSections: ReadonlySet<string>,
  sectionId: string,
): ReadonlySet<string> {
  const next = new Set(expandedSections);
  if (next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  return next;
}

export function stepRow(
  rows: readonly BranchesSidebarRow[],
  activeRowId: string | undefined,
  step: number,
): string | undefined {
  if (rows.length === 0) return undefined;
  const activeIndex = rows.findIndex((row) => row.id === activeRowId);
  const nextIndex =
    activeIndex < 0
      ? step > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, activeIndex + step));
  return rows[nextIndex]?.id;
}

export function currentRefRowId(
  rows: readonly BranchesSidebarRow[],
): string | undefined {
  return rows.find((row) => row.kind === "ref" && row.current)?.id;
}

function draftPosition(rows: readonly BranchesSidebarRow[], sectionId: string) {
  const index = rows.findIndex(
    (row) => row.kind === "section" && row.sectionId === sectionId,
  );
  if (index >= 0) return index + 1;
  return sectionId === localBranchesSectionId ? 0 : rows.length;
}

function createMatcher(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return (name: string) =>
    normalized.length === 0 || name.toLocaleLowerCase().includes(normalized);
}

function branchPriority(
  name: string,
  worktreePath: string | undefined,
  currentBranch: string | undefined,
): number {
  if (name === currentBranch) return 0;
  if (worktreePath !== undefined) return 1;
  return 2;
}

function groupByRemote(
  remoteBranches: readonly RemoteBranch[],
): readonly (readonly [string, readonly RemoteBranch[]])[] {
  const groups = new Map<string, RemoteBranch[]>();
  for (const branch of remoteBranches) {
    const group = groups.get(branch.remote);
    if (group === undefined) groups.set(branch.remote, [branch]);
    else group.push(branch);
  }
  return [...groups.entries()];
}

interface SectionDraft {
  readonly refs: readonly Omit<
    BranchesSidebarRefRow,
    | "id"
    | "kind"
    | "sectionId"
    | "label"
    | "level"
    | "parentId"
    | "position"
    | "setSize"
  >[];
  readonly sectionId: string;
  readonly scope: Exclude<BranchesSidebarScope, "all">;
  readonly title: string;
  readonly truncated: boolean;
}
