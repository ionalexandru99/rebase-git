import type {
  BranchUpstream,
  RemoteBranch,
  RepositoryRefs,
  RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import type { RepositoryStash } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  type BranchesSidebarFolderRow,
  buildBranchTree,
  type RowHierarchy,
} from "#web/features/branches-sidebar/branch-tree.ts";
import type { RefKind } from "#web/features/refs/ref-kinds.ts";
import { activeHead } from "#web/features/refs/repository-refs.ts";

export const localBranchesSectionId = "branches";
export const tagsSectionId = "tags";
export const stashesSectionId = "stashes";

export type BranchesSidebarScope =
  | "all"
  | "local"
  | "remote"
  | "tags"
  | "stashes";
export type BranchesSidebarSectionScope = Exclude<BranchesSidebarScope, "all">;
export type BranchesSidebarView = "linear" | "tree";

export interface BranchesSidebarTreeOptions {
  readonly view: BranchesSidebarView;
  readonly folders: ReadonlyMap<string, boolean>;
}

export interface BranchesSidebarSectionRow extends RowHierarchy {
  readonly count: number;
  readonly expanded: boolean;
  readonly id: string;
  readonly kind: "section";
  readonly scope: BranchesSidebarSectionScope;
  readonly sectionId: string;
  readonly title: string;
  readonly truncated: boolean;
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

export interface BranchesSidebarStashRow extends RowHierarchy {
  readonly id: string;
  readonly kind: "stash";
  readonly parentId: string;
  readonly sectionId: string;
  readonly stash: RepositoryStash;
}

export interface BranchesSidebarStashes {
  readonly list: readonly RepositoryStash[];
  readonly drafting: boolean;
}

export type BranchesSidebarRow =
  | BranchesSidebarRefRow
  | BranchesSidebarFolderRow
  | BranchesSidebarSectionRow
  | BranchesSidebarStashRow;

export type BranchesSidebarExpandableRow = Exclude<
  BranchesSidebarRow,
  { kind: "ref" | "stash" }
>;

export type BranchesSidebarItem =
  | {
      readonly id: string;
      readonly kind: "row";
      readonly row: BranchesSidebarRow;
    }
  | { readonly id: "ref-draft"; readonly kind: "draft" }
  | { readonly id: "stash-draft"; readonly kind: "stash-draft" }
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
  stashesSectionId,
]);

const noStashes: BranchesSidebarStashes = { list: [], drafting: false };

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
  stashes: BranchesSidebarStashes = noStashes,
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
    {
      refs: [],
      stashes: stashes.list.filter((stash) => matches(stash.name)),
      sectionId: stashesSectionId,
      scope: "stashes",
      title: "Stashes",
      truncated: false,
    },
  ];

  const visibleSections = sections
    .filter(sectionMatchesScope(scope))
    .filter(
      (section) =>
        (section.scope === "stashes" && stashes.drafting) ||
        ((!filtering || sectionSize(section) > 0) &&
          (section.scope !== "tags" ||
            section.refs.length > 0 ||
            section.truncated) &&
          (section.scope !== "stashes" || sectionSize(section) > 0)),
    );
  return visibleSections.flatMap((section, index): BranchesSidebarRow[] => {
    const expanded =
      filtering ||
      expandedSections.has(section.sectionId) ||
      (section.scope === "stashes" && stashes.drafting);
    const header: BranchesSidebarSectionRow = {
      level: 1,
      position: index + 1,
      setSize: visibleSections.length,
      count: sectionSize(section),
      expanded,
      id: `section:${section.sectionId}`,
      kind: "section",
      scope: section.scope,
      sectionId: section.sectionId,
      title: section.title,
      truncated: section.truncated,
    };
    if (!expanded) return [header];
    if (section.stashes !== undefined)
      return [
        header,
        ...section.stashes.map(
          (stash, position): BranchesSidebarStashRow => ({
            id: `stash:${stash.oid}`,
            kind: "stash",
            level: 2,
            parentId: header.id,
            position: position + 1,
            sectionId: section.sectionId,
            setSize: section.stashes?.length ?? 0,
            stash,
          }),
        ),
      ];
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
  stashDraft = false,
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
  if (stashDraft) {
    const header = items.findIndex(
      (item) => item.id === `section:${stashesSectionId}`,
    );
    items.splice(header < 0 ? items.length : header + 1, 0, {
      id: "stash-draft",
      kind: "stash-draft",
    });
  }
  return items;
}

export function dockItems(items: readonly BranchesSidebarItem[]): {
  readonly top: readonly BranchesSidebarItem[];
  readonly docked: readonly BranchesSidebarItem[];
} {
  const start = items.findIndex(
    (item) =>
      item.kind === "row" &&
      item.row.kind === "section" &&
      item.row.sectionId !== localBranchesSectionId,
  );
  return start < 0
    ? { top: items, docked: [] }
    : { top: items.slice(0, start), docked: items.slice(start) };
}

export function estimateItemHeight(item: BranchesSidebarItem | undefined) {
  if (item?.kind === "draft") return 40;
  if (item?.kind === "stash-draft") return 52;
  if (item?.kind === "details") return 56;
  return 32;
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
        : sectionId === stashesSectionId
          ? "stashes"
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

function sectionSize(section: SectionDraft) {
  return section.refs.length + (section.stashes?.length ?? 0);
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
  readonly stashes?: readonly RepositoryStash[];
  readonly sectionId: string;
  readonly scope: BranchesSidebarSectionScope;
  readonly title: string;
  readonly truncated: boolean;
}
