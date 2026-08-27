import type {
  RemoteBranch,
  RepositoryRefs,
  RepositoryRefTarget,
} from "@rebase/contracts";
import {
  type BranchesSidebarRefRow,
  type BranchesSidebarRow,
  type BranchesSidebarSectionRow,
  localBranchesSectionId,
  type RefSelection,
  tagsSectionId,
} from "#web/features/branches-sidebar/branches-sidebar.contract";

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
): readonly BranchesSidebarRow[] {
  const matches = createMatcher(query);
  const filtering = query.trim().length > 0;
  const currentBranch = activeHead(refs, activeWorktreePath)?.branch;
  const sections: readonly SectionDraft[] = [
    {
      refs: refs.branches
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
            : { worktreePath: branch.worktreePath }),
        })),
      sectionId: localBranchesSectionId,
      title: "Branches",
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
      title: "Tags",
      truncated: refs.truncated.tags,
    },
  ];

  return sections.flatMap((section) => {
    if (filtering && section.refs.length === 0) return [];
    const expanded = filtering || expandedSections.has(section.sectionId);
    const header: BranchesSidebarSectionRow = {
      count: section.refs.length,
      expanded,
      id: `section:${section.sectionId}`,
      kind: "section",
      sectionId: section.sectionId,
      title: section.title,
      truncated: section.truncated,
    };
    return expanded
      ? [
          header,
          ...section.refs.map(
            (ref): BranchesSidebarRefRow => ({
              ...ref,
              id: `ref:${section.sectionId}:${ref.name}`,
              kind: "ref",
              sectionId: section.sectionId,
            }),
          ),
        ]
      : [header];
  });
}

export function resolveRefSelection(
  refs: RepositoryRefs,
  activeWorktreePath: string,
  target: RepositoryRefTarget,
): RefSelection {
  if (target._tag === "RemoteBranch") {
    return refs.branches.some(
      (branch) =>
        branch.name === target.name &&
        (branch.upstream === undefined ||
          branch.upstream.name === `${target.remote}/${target.name}`),
    )
      ? resolveRefSelection(refs, activeWorktreePath, {
          _tag: "LocalBranch",
          name: target.name,
        })
      : { _tag: "Checkout", target };
  }
  if (target._tag === "Tag") return { _tag: "Checkout", target };

  const branch = refs.branches.find(
    (candidate) => candidate.name === target.name,
  );
  if (
    branch?.worktreePath !== undefined &&
    branch.worktreePath !== activeWorktreePath
  ) {
    return { _tag: "SwitchWorktree", worktreePath: branch.worktreePath };
  }
  return activeHead(refs, activeWorktreePath)?.branch === target.name
    ? { _tag: "AlreadyCurrent" }
    : { _tag: "Checkout", target };
}

export function activeHead(refs: RepositoryRefs, activeWorktreePath: string) {
  return refs.worktrees.find((worktree) => worktree.path === activeWorktreePath)
    ?.head;
}

export function resolveActiveWorktreePath(
  refs: RepositoryRefs,
  preferredPath: string,
): string {
  if (refs.worktrees.some((worktree) => worktree.path === preferredPath)) {
    return preferredPath;
  }
  return (
    refs.worktrees.find((worktree) => worktree.main)?.path ??
    refs.worktrees[0]?.path ??
    preferredPath
  );
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

export function sectionRowId(sectionId: string): string {
  return `section:${sectionId}`;
}

export function currentRefRowId(
  rows: readonly BranchesSidebarRow[],
): string | undefined {
  return rows.find((row) => row.kind === "ref" && row.current)?.id;
}

function createMatcher(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return (name: string) =>
    normalized.length === 0 || name.toLocaleLowerCase().includes(normalized);
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
    "id" | "kind" | "sectionId"
  >[];
  readonly sectionId: string;
  readonly title: string;
  readonly truncated: boolean;
}
