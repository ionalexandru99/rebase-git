import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type BranchesSidebarScope,
  type BranchesSidebarStashes,
  type BranchesSidebarTreeOptions,
  buildBranchesSidebarRows,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";

export function sidebarRows(
  refs: RepositoryRefs,
  activeWorktreePath: string,
  expandedSections: ReadonlySet<string>,
  query: string,
  scope: BranchesSidebarScope = "all",
  tree: BranchesSidebarTreeOptions = { view: "linear", folders: new Map() },
  stashes: BranchesSidebarStashes = { list: [], drafting: false },
) {
  return buildBranchesSidebarRows(
    refs,
    activeWorktreePath,
    expandedSections,
    query,
    scope,
    tree,
    stashes,
  );
}
